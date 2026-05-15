package watch

import (
	"context"
	"database/sql"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"maps"
	"math"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	tldgit "github.com/mertcikla/tld/v2/internal/git"
)

func applyGitLineDiff(diff *RepresentationDiff, snapshot watchResourceSnapshot, previous *watchResourceSnapshot, lineDiffs map[string]tldgit.LineDiff, lineHunks map[string][]tldgit.LineHunk) {
	if diff == nil || len(lineDiffs) == 0 || diff.ChangeType != "updated" {
		return
	}
	file := snapshotDiffFilePath(snapshot)
	if file == "" {
		return
	}
	if symbolLineAttributionCandidate(snapshot) {
		if added, removed, ok := symbolLineDiff(snapshot, previous, lineHunks[file]); ok {
			diff.AddedLines = added
			diff.RemovedLines = removed
			return
		}
	}
	lineDiff, ok := lineDiffs[file]
	if !ok {
		return
	}
	diff.AddedLines = lineDiff.Added
	diff.RemovedLines = lineDiff.Removed
}

func symbolLineAttributionCandidate(snapshot watchResourceSnapshot) bool {
	return snapshot.OwnerType == "symbol" || (snapshot.ResourceType == "element" && snapshot.OwnerType == "symbol")
}

func symbolLineDiff(snapshot watchResourceSnapshot, previous *watchResourceSnapshot, hunks []tldgit.LineHunk) (int, int, bool) {
	if len(hunks) == 0 || snapshot.StartLine <= 0 || snapshot.EndLine <= 0 {
		return 0, 0, false
	}
	oldStart, oldEnd := snapshot.StartLine, snapshot.EndLine
	if previous != nil && previous.StartLine > 0 && previous.EndLine > 0 {
		oldStart, oldEnd = previous.StartLine, previous.EndLine
	}
	added, removed := 0, 0
	for _, hunk := range hunks {
		added += countLinesInRange(hunk.AddedLines, snapshot.StartLine, snapshot.EndLine)
		removed += countLinesInRange(hunk.RemovedLines, oldStart, oldEnd)
	}
	return added, removed, true
}

func countLinesInRange(lines []int, start, end int) int {
	if start <= 0 || end < start {
		return 0
	}
	count := 0
	for _, line := range lines {
		if line >= start && line <= end {
			count++
		}
	}
	return count
}

func snapshotDiffFilePath(snapshot watchResourceSnapshot) string {
	paths := snapshotDiffFilePaths(snapshot)
	if len(paths) == 0 {
		return ""
	}
	return paths[0]
}

func snapshotDiffFilePaths(snapshot watchResourceSnapshot) []string {
	if path := filepathToSlash(snapshot.FilePath); path != "" {
		return []string{path}
	}
	switch snapshot.OwnerType {
	case "file":
		if path := strings.TrimPrefix(snapshot.OwnerKey, "file:"); strings.TrimSpace(path) != "" {
			return []string{filepathToSlash(path)}
		}
	case "symbol":
		if file, ok := filePathFromStableKey(snapshot.OwnerKey); ok {
			return []string{file}
		}
	case "file-reference":
		return filePairPaths(strings.TrimPrefix(snapshot.OwnerKey, "file:"))
	case "reference":
		return referenceOwnerPaths(snapshot.OwnerKey)
	}
	return nil
}

func filePairPaths(value string) []string {
	parts := strings.Split(value, "->")
	if len(parts) != 2 {
		return nil
	}
	var out []string
	for _, part := range parts {
		if path := filepathToSlash(strings.TrimSpace(part)); path != "" {
			out = append(out, path)
		}
	}
	return out
}

func referenceOwnerPaths(ownerKey string) []string {
	ownerKey = strings.TrimPrefix(ownerKey, "symbol:")
	parts := strings.Split(ownerKey, ":")
	seen := map[string]struct{}{}
	var out []string
	for i := 0; i+3 < len(parts); i++ {
		candidate := strings.Join(parts[i:i+4], ":")
		path, ok := filePathFromStableKey(candidate)
		if !ok {
			continue
		}
		if _, exists := seen[path]; exists {
			continue
		}
		seen[path] = struct{}{}
		out = append(out, path)
	}
	return out
}

func materializedLineCount(ctx context.Context, db *sql.DB, repositoryID int64, ownerType, ownerKey, filePath string) int {
	switch ownerType {
	case "symbol":
		return symbolLineCount(ctx, db, repositoryID, ownerKey)
	case "file":
		return fileLineCount(ctx, db, repositoryID, strings.TrimPrefix(ownerKey, "file:"))
	}
	if count := sourceAnchorLineCount(filePath); count > 0 {
		return count
	}
	return 0
}

func symbolLineCount(ctx context.Context, db *sql.DB, repositoryID int64, ownerKey string) int {
	var startLine int
	var endLine sql.NullInt64
	err := db.QueryRowContext(ctx, `
		SELECT s.start_line, s.end_line
		FROM watch_symbols s
		LEFT JOIN watch_symbol_identities i ON i.repository_id = s.repository_id AND i.current_stable_key = s.stable_key
		WHERE s.repository_id = ? AND COALESCE(i.identity_key, s.stable_key) = ?
		ORDER BY s.id
		LIMIT 1`, repositoryID, ownerKey).Scan(&startLine, &endLine)
	if err != nil {
		return 0
	}
	return lineCountFromRange(startLine, endLine)
}

func materializedSourceRange(ctx context.Context, db *sql.DB, repositoryID int64, ownerType, ownerKey, fallbackFilePath string) (string, int, int) {
	switch ownerType {
	case "symbol":
		return symbolLineRange(ctx, db, repositoryID, ownerKey)
	case "file":
		path := strings.TrimPrefix(ownerKey, "file:")
		if strings.TrimSpace(path) == "" {
			path = fallbackFilePath
		}
		return filepathToSlash(path), 0, 0
	default:
		if path := sourceAnchorFilePath(fallbackFilePath); path != "" {
			start, end := sourceAnchorRange(fallbackFilePath)
			return path, start, end
		}
	}
	return filepathToSlash(fallbackFilePath), 0, 0
}

func symbolLineRange(ctx context.Context, db *sql.DB, repositoryID int64, ownerKey string) (string, int, int) {
	var filePath string
	var startLine int
	var endLine sql.NullInt64
	err := db.QueryRowContext(ctx, `
		SELECT f.path, s.start_line, s.end_line
		FROM watch_symbols s
		JOIN watch_files f ON f.id = s.file_id
		LEFT JOIN watch_symbol_identities i ON i.repository_id = s.repository_id AND i.current_stable_key = s.stable_key
		WHERE s.repository_id = ? AND COALESCE(i.identity_key, s.stable_key) = ?
		ORDER BY s.id
		LIMIT 1`, repositoryID, ownerKey).Scan(&filePath, &startLine, &endLine)
	if err != nil {
		return "", 0, 0
	}
	return filepathToSlash(filePath), startLine, normalizedEndLine(startLine, endLine)
}

func symbolSnapshotHash(ctx context.Context, db *sql.DB, repositoryID int64, ownerKey string) string {
	var contentHash, signatureHash string
	var startLine int
	var endLine sql.NullInt64
	err := db.QueryRowContext(ctx, `
		SELECT s.content_hash, s.signature_hash, s.start_line, s.end_line
		FROM watch_symbols s
		LEFT JOIN watch_symbol_identities i ON i.repository_id = s.repository_id AND i.current_stable_key = s.stable_key
		WHERE s.repository_id = ? AND COALESCE(i.identity_key, s.stable_key) = ?
		ORDER BY s.id
		LIMIT 1`, repositoryID, ownerKey).Scan(&contentHash, &signatureHash, &startLine, &endLine)
	if err != nil {
		return ""
	}
	return fmt.Sprintf("%s:%s:%d", contentHash, signatureHash, lineCountFromRange(startLine, endLine))
}

func normalizedEndLine(startLine int, endLine sql.NullInt64) int {
	if startLine <= 0 {
		return 0
	}
	if endLine.Valid && int(endLine.Int64) >= startLine {
		return int(endLine.Int64)
	}
	return startLine
}

func lineCountFromRange(startLine int, endLine sql.NullInt64) int {
	if startLine <= 0 {
		return 0
	}
	end := startLine
	if endLine.Valid {
		end = int(endLine.Int64)
	}
	if end < startLine {
		return 0
	}
	return end - startLine + 1
}

func fileLineCount(ctx context.Context, db *sql.DB, repositoryID int64, filePath string) int {
	if strings.TrimSpace(filePath) == "" {
		return 0
	}
	var maxEnd sql.NullInt64
	err := db.QueryRowContext(ctx, `
		SELECT MAX(COALESCE(s.end_line, s.start_line))
		FROM watch_symbols s
		JOIN watch_files f ON f.id = s.file_id
		WHERE s.repository_id = ? AND f.path = ?`, repositoryID, filePath).Scan(&maxEnd)
	if err != nil || !maxEnd.Valid {
		return 0
	}
	return int(maxEnd.Int64)
}

func sourceAnchorLineCount(filePath string) int {
	start, end := sourceAnchorRange(filePath)
	if start <= 0 || end < start {
		return 0
	}
	return end - start + 1
}

func sourceAnchorRange(filePath string) (int, int) {
	hash := strings.IndexByte(filePath, '#')
	if hash < 0 || hash == len(filePath)-1 {
		return 0, 0
	}
	var anchor struct {
		StartLine int `json:"startLine"`
		EndLine   int `json:"endLine"`
	}
	if err := json.Unmarshal([]byte(filePath[hash+1:]), &anchor); err != nil {
		return 0, 0
	}
	if anchor.StartLine <= 0 {
		return 0, 0
	}
	if anchor.EndLine <= 0 {
		anchor.EndLine = anchor.StartLine
	}
	if anchor.EndLine < anchor.StartLine {
		return 0, 0
	}
	return anchor.StartLine, anchor.EndLine
}

func sourceAnchorFilePath(filePath string) string {
	before, _, ok := strings.Cut(filePath, "#")
	if !ok {
		return filepathToSlash(filePath)
	}
	return filepathToSlash(before)
}

func lineDelta(changeType string, lineCount int, previous *watchResourceSnapshot) (int, int) {
	if lineCount < 0 {
		lineCount = 0
	}
	switch changeType {
	case "added":
		return lineCount, 0
	case "deleted":
		return 0, lineCount
	case "updated":
		if previous == nil || previous.LineCount <= 0 || lineCount <= 0 {
			return 0, 0
		}
		delta := lineCount - previous.LineCount
		if delta > 0 {
			return delta, 0
		}
		if delta < 0 {
			return 0, -delta
		}
	}
	return 0, 0
}

func resourceSnapshotKey(ownerType, ownerKey, resourceType string) string {
	return ownerType + "\x00" + ownerKey + "\x00" + resourceType
}

func ptrInt64Value(value *int64) int64 {
	if value == nil {
		return 0
	}
	return *value
}

func stringPtrIf(ok bool, value string) *string {
	if !ok {
		return nil
	}
	return &value
}

func diffLanguage(diff RepresentationDiff) string {
	if diff.Language != nil {
		return *diff.Language
	}
	if diff.OwnerType == "symbol" || diff.ResourceType != nil && *diff.ResourceType == "symbol" {
		return languageFromStableKey(diff.OwnerKey)
	}
	return ""
}

func (s *Store) fileByPath(ctx context.Context, repositoryID int64, path string) (File, bool, error) {
	file, err := s.fileByPathMust(ctx, repositoryID, path)
	if errors.Is(err, sql.ErrNoRows) {
		return File{}, false, nil
	}
	return file, err == nil, err
}

func scanLock(row rowScanner) (Lock, error) {
	var lock Lock
	if err := row.Scan(&lock.ID, &lock.RepositoryID, &lock.PID, &lock.Token, &lock.StartedAt, &lock.HeartbeatAt, &lock.Status); err != nil {
		return Lock{}, err
	}
	return lock, nil
}

func scanVersion(row rowScanner) (Version, error) {
	var version Version
	var message sql.NullString
	var parent sql.NullString
	var branch sql.NullString
	var workspaceVersionID sql.NullInt64
	if err := row.Scan(&version.ID, &version.RepositoryID, &version.CommitHash, &message, &parent, &branch, &version.RepresentationHash, &workspaceVersionID, &version.CreatedAt); err != nil {
		return Version{}, err
	}
	if message.Valid {
		version.CommitMessage = message.String
	}
	if parent.Valid {
		version.ParentCommitHash = parent.String
	}
	if branch.Valid {
		version.Branch = branch.String
	}
	if workspaceVersionID.Valid {
		version.WorkspaceVersionID = &workspaceVersionID.Int64
	}
	return version, nil
}

func (s *Store) addElementTags(ctx context.Context, elementID int64, add []string) (int, error) {
	var raw string
	if err := s.db.QueryRowContext(ctx, `SELECT tags FROM elements WHERE id = ?`, elementID).Scan(&raw); err != nil {
		return 0, err
	}
	var tags []string
	_ = json.Unmarshal([]byte(raw), &tags)
	seen := make(map[string]struct{}, len(tags)+len(add))
	next := make([]string, 0, len(tags)+len(add))
	added := 0
	for _, tag := range tags {
		if _, ok := seen[tag]; ok {
			continue
		}
		seen[tag] = struct{}{}
		next = append(next, tag)
	}
	for _, tag := range add {
		if _, ok := seen[tag]; ok {
			continue
		}
		seen[tag] = struct{}{}
		next = append(next, tag)
		added++
	}
	if added == 0 {
		return 0, nil
	}
	data, _ := json.Marshal(next)
	_, err := s.db.ExecContext(ctx, `UPDATE elements SET tags = ?, updated_at = ? WHERE id = ?`, string(data), nowString(), elementID)
	return added, err
}

func (s *Store) removeElementTags(ctx context.Context, elementID int64, remove []string) (int, error) {
	var raw string
	if err := s.db.QueryRowContext(ctx, `SELECT tags FROM elements WHERE id = ?`, elementID).Scan(&raw); err != nil {
		return 0, err
	}
	var tags []string
	_ = json.Unmarshal([]byte(raw), &tags)
	removeSet := make(map[string]struct{}, len(remove))
	for _, tag := range remove {
		removeSet[tag] = struct{}{}
	}
	next := make([]string, 0, len(tags))
	removed := 0
	for _, tag := range tags {
		if _, ok := removeSet[tag]; ok {
			removed++
			continue
		}
		next = append(next, tag)
	}
	if removed == 0 {
		return 0, nil
	}
	data, _ := json.Marshal(next)
	_, err := s.db.ExecContext(ctx, `UPDATE elements SET tags = ?, updated_at = ? WHERE id = ?`, string(data), nowString(), elementID)
	return removed, err
}

func managedGitTags() []string {
	return []string{"git:staged", "git:unstaged", "git:untracked", "watch:deleted"}
}

func stringSet(values []string) map[string]struct{} {
	out := make(map[string]struct{}, len(values))
	for _, value := range values {
		out[value] = struct{}{}
	}
	return out
}

func sortedSetValues(values map[string]struct{}) []string {
	if len(values) == 0 {
		return nil
	}
	out := make([]string, 0, len(values))
	for value := range values {
		out = append(out, value)
	}
	sort.Strings(out)
	return out
}

func filepathToSlash(path string) string {
	return strings.ReplaceAll(path, "\\", "/")
}

func absInt(value int) int {
	if value < 0 {
		return -value
	}
	return value
}

func sameQualifierParent(left, right string) bool {
	leftParent := qualifierParent(left)
	rightParent := qualifierParent(right)
	return leftParent != "" && leftParent == rightParent
}

func qualifierParent(value string) string {
	if idx := strings.LastIndex(value, "."); idx > 0 {
		return value[:idx]
	}
	return ""
}

func nameTokenSimilarity(left, right string) float64 {
	leftTokens := splitIdentifierToken(pathBaseQualifier(left))
	rightTokens := splitIdentifierToken(pathBaseQualifier(right))
	if len(leftTokens) == 0 || len(rightTokens) == 0 {
		return 0
	}
	leftSet := make(map[string]struct{}, len(leftTokens))
	for _, token := range leftTokens {
		leftSet[token] = struct{}{}
	}
	intersection := 0
	union := len(leftSet)
	for _, token := range rightTokens {
		if _, ok := leftSet[token]; ok {
			intersection++
			continue
		}
		union++
	}
	if union == 0 {
		return 0
	}
	return float64(intersection) / float64(union)
}

func pathBaseQualifier(value string) string {
	if idx := strings.LastIndex(value, "."); idx >= 0 && idx+1 < len(value) {
		return value[idx+1:]
	}
	return value
}

func embeddingDataset(modelID int64) string {
	return fmt.Sprintf("model:%d", modelID)
}

func bytesToVector(data []byte) Vector {
	if len(data)%4 != 0 {
		return nil
	}
	vector := make(Vector, len(data)/4)
	for i := range vector {
		vector[i] = math.Float32frombits(binary.LittleEndian.Uint32(data[i*4:]))
	}
	return vector
}

func (s *Store) clusterByStableKey(ctx context.Context, repositoryID int64, stableKey string) (Cluster, error) {
	row := s.db.QueryRowContext(ctx, `
		SELECT id, repository_id, stable_key, parent_cluster_id, name, kind, algorithm, settings_hash, member_count, created_at, updated_at
		FROM watch_clusters
		WHERE repository_id = ? AND stable_key = ?`, repositoryID, stableKey)
	return scanCluster(row)
}

type rowScanner interface {
	Scan(dest ...any) error
}

func scanCluster(row rowScanner) (Cluster, error) {
	var cluster Cluster
	var parent sql.NullInt64
	if err := row.Scan(&cluster.ID, &cluster.RepositoryID, &cluster.StableKey, &parent, &cluster.Name, &cluster.Kind, &cluster.Algorithm, &cluster.SettingsHash, &cluster.MemberCount, &cluster.CreatedAt, &cluster.UpdatedAt); err != nil {
		return Cluster{}, err
	}
	if parent.Valid {
		cluster.ParentClusterID = &parent.Int64
	}
	return cluster, nil
}

func (s *Store) latestFilterRunID(ctx context.Context, repositoryID int64) (int64, error) {
	var id int64
	err := s.db.QueryRowContext(ctx, `
		SELECT id FROM watch_filter_runs
		WHERE repository_id = ?
		ORDER BY id DESC
		LIMIT 1`, repositoryID).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, nil
	}
	return id, err
}

func (s *Store) fileByPathMust(ctx context.Context, repositoryID int64, path string) (File, error) {
	var file File
	err := s.db.QueryRowContext(ctx, `
		SELECT id, repository_id, path, language, git_blob_hash, worktree_hash, size_bytes, mtime_unix, scan_status, scan_error, created_at, updated_at
		FROM watch_files
		WHERE repository_id = ? AND path = ?`, repositoryID, path).Scan(&file.ID, &file.RepositoryID, &file.Path, &file.Language, &file.GitBlobHash, &file.WorktreeHash, &file.SizeBytes, &file.MtimeUnix, &file.ScanStatus, &file.ScanError, &file.CreatedAt, &file.UpdatedAt)
	return file, err
}

func (s *Store) file(ctx context.Context, id int64) (File, error) {
	var file File
	err := s.db.QueryRowContext(ctx, `
		SELECT id, repository_id, path, language, git_blob_hash, worktree_hash, size_bytes, mtime_unix, scan_status, scan_error, created_at, updated_at
		FROM watch_files
		WHERE id = ?`, id).Scan(&file.ID, &file.RepositoryID, &file.Path, &file.Language, &file.GitBlobHash, &file.WorktreeHash, &file.SizeBytes, &file.MtimeUnix, &file.ScanStatus, &file.ScanError, &file.CreatedAt, &file.UpdatedAt)
	return file, err
}

func nullString(value string) any {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	return value
}

func nowString() string {
	return time.Now().UTC().Format(time.RFC3339)
}
func elementName(ctx context.Context, db *sql.DB, id int64) string {
	var name sql.NullString
	if err := db.QueryRowContext(ctx, `SELECT name FROM elements WHERE id = ?`, id).Scan(&name); err != nil || !name.Valid {
		return ""
	}
	return strings.TrimSpace(name.String)
}

func shouldEmitInitialSnapshotDiff(snapshot watchResourceSnapshot, changes map[string]tldgit.WorktreeChange) (string, bool) {
	changeType := initialSnapshotChangeType(snapshot, changes)
	if len(changes) > 0 && changeType == "initialized" {
		return changeType, false
	}
	return changeType, true
}

func initialSnapshotChangeType(snapshot watchResourceSnapshot, changes map[string]tldgit.WorktreeChange) string {
	if len(changes) == 0 {
		return "initialized"
	}
	paths := snapshotDiffFilePaths(snapshot)
	if len(paths) == 0 {
		return "initialized"
	}
	hasUpdated := false
	for _, path := range paths {
		switch changes[path] {
		case tldgit.WorktreeAdded:
			return "added"
		case tldgit.WorktreeUpdated:
			hasUpdated = true
		}
	}
	if hasUpdated {
		return "updated"
	}
	return "initialized"
}

func cloneWatchResourceSnapshots(in map[string]watchResourceSnapshot) map[string]watchResourceSnapshot {
	out := make(map[string]watchResourceSnapshot, len(in))
	maps.Copy(out, in)
	return out
}

func sortMaterializationMappingsForDelete(items []watchMaterializationMapping) {
	order := map[string]int{"connector": 0, "view": 1, "element": 2}
	sort.Slice(items, func(i, j int) bool {
		left, right := order[items[i].ResourceType], order[items[j].ResourceType]
		if left == right {
			return items[i].ID < items[j].ID
		}
		return left < right
	})
}

func hashCanonicalPayload(payload any) string {
	data, _ := json.Marshal(payload)
	return hashBytes(data)
}

func nullableString(value sql.NullString) any {
	if !value.Valid {
		return nil
	}
	return value.String
}

func normalizedJSONValue(raw string) any {
	var value any
	if err := json.Unmarshal([]byte(raw), &value); err != nil {
		return raw
	}
	return value
}

func normalizedElementTagsForHash(raw string) any {
	var tags []string
	if err := json.Unmarshal([]byte(raw), &tags); err != nil {
		return normalizedJSONValue(raw)
	}
	managed := stringSet(managedGitTags())
	filtered := make([]string, 0, len(tags))
	for _, tag := range tags {
		if _, ok := managed[tag]; ok {
			continue
		}
		filtered = append(filtered, tag)
	}
	return filtered
}

func buildParameterList(ids []int64) (string, []any) {
	args := make([]any, len(ids))
	placeholders := make([]string, len(ids))
	for i, id := range ids {
		placeholders[i] = "?"
		args[i] = id
	}
	return strings.Join(placeholders, ","), args
}

func scanReferences(rows *sql.Rows) ([]Reference, error) {
	var out []Reference
	for rows.Next() {
		var ref Reference
		if err := rows.Scan(&ref.ID, &ref.RepositoryID, &ref.SourceSymbolID, &ref.TargetSymbolID, &ref.SourceFileID, &ref.Kind, &ref.Line, &ref.Column, &ref.EvidenceHash, &ref.RawJSON, &ref.CreatedAt, &ref.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, ref)
	}
	return out, rows.Err()
}

func sourcePathMissing(repoRoot, relPath string) bool {
	cleanRel := filepath.Clean(filepath.FromSlash(relPath))
	if filepath.IsAbs(cleanRel) || cleanRel == "." || cleanRel == ".." || strings.HasPrefix(cleanRel, ".."+string(filepath.Separator)) {
		return false
	}
	_, err := os.Stat(filepath.Join(repoRoot, cleanRel))
	return errors.Is(err, os.ErrNotExist)
}

func filePathFromStableKey(stableKey string) (string, bool) {
	parts := strings.SplitN(stableKey, ":", 4)
	if len(parts) < 4 || strings.TrimSpace(parts[1]) == "" {
		return "", false
	}
	return filepathToSlash(parts[1]), true
}

func snapshotDiff(snapshot watchResourceSnapshot, changeType string, beforeHash, afterHash *string, previous *watchResourceSnapshot) RepresentationDiff {
	resourceType := snapshot.ResourceType
	summary := snapshot.Summary
	language := snapshot.Language
	addedLines, removedLines := lineDelta(changeType, snapshot.LineCount, previous)
	return RepresentationDiff{OwnerType: snapshot.OwnerType, OwnerKey: snapshot.OwnerKey, ChangeType: changeType, BeforeHash: beforeHash, AfterHash: afterHash, ResourceType: &resourceType, ResourceID: snapshot.ResourceID, Language: &language, Summary: &summary, AddedLines: addedLines, RemovedLines: removedLines}
}

func previousRawSnapshotForMaterialized(previous, current map[string]watchResourceSnapshot, snapshot watchResourceSnapshot) (watchResourceSnapshot, bool) {
	if snapshot.ResourceType != "element" {
		return watchResourceSnapshot{}, false
	}
	rawType := ""
	rawOwnerKey := snapshot.OwnerKey
	switch snapshot.OwnerType {
	case "file":
		rawType = "file"
		rawOwnerKey = strings.TrimPrefix(snapshot.OwnerKey, "file:")
	case "symbol":
		rawType = "symbol"
	default:
		return watchResourceSnapshot{}, false
	}
	rawKey := resourceSnapshotKey(snapshot.OwnerType, rawOwnerKey, rawType)
	prev, ok := previous[rawKey]
	if !ok {
		return watchResourceSnapshot{}, false
	}
	next, ok := current[rawKey]
	if !ok || prev.Hash == next.Hash {
		return watchResourceSnapshot{}, false
	}
	return prev, true
}

func scanFact(row factScanner) (Fact, error) {
	var fact Fact
	var endLine sql.NullInt64
	var rawTags string
	if err := row.Scan(&fact.ID, &fact.RepositoryID, &fact.FileID, &fact.FilePath, &fact.StableKey, &fact.Type, &fact.Enricher, &fact.SubjectKind, &fact.SubjectStableKey, &fact.ObjectKind, &fact.ObjectStableKey, &fact.ObjectFilePath, &fact.ObjectName, &fact.Relationship, &fact.StartLine, &endLine, &fact.Confidence, &fact.Name, &rawTags, &fact.AttributesJSON, &fact.VisibilityHintsJSON, &fact.FactHash, &fact.RawJSON, &fact.CreatedAt, &fact.UpdatedAt); err != nil {
		return Fact{}, err
	}
	if endLine.Valid {
		value := int(endLine.Int64)
		fact.EndLine = &value
	}
	_ = json.Unmarshal([]byte(rawTags), &fact.Tags)
	return fact, nil
}
