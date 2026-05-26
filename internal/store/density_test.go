package store

import (
	"context"
	"testing"

	"github.com/mertcikla/tld/v2/internal/app"
)

func seedDensityView(t *testing.T, sqliteStore *SQLiteStore) {
	t.Helper()
	if _, err := sqliteStore.DB().Exec(`
		INSERT INTO elements(id, name, tags, technology_connectors, created_at, updated_at)
		VALUES
			(101, 'A', '[]', '[]', 'now', 'now'),
			(102, 'B', '[]', '[]', 'now', 'now'),
			(103, 'C', '[]', '[]', 'now', 'now'),
			(104, 'D', '[]', '[]', 'now', 'now'),
			(105, 'E', '[]', '[]', 'now', 'now'),
			(106, 'F', '[]', '[]', 'now', 'now');
		INSERT INTO placements(view_id, element_id, position_x, position_y, created_at, updated_at)
		VALUES
			(1, 101, 0, 0, 'now', 'now'),
			(1, 102, 10, 0, 'now', 'now'),
			(1, 103, 20, 0, 'now', 'now'),
			(1, 104, 30, 0, 'now', 'now'),
			(1, 105, 40, 0, 'now', 'now'),
			(1, 106, 50, 0, 'now', 'now');
		INSERT INTO connectors(id, view_id, source_element_id, target_element_id, label, direction, style, created_at, updated_at)
		VALUES
			(201, 1, 101, 102, 'important', 'forward', 'bezier', 'now', 'now'),
			(202, 1, 105, 106, NULL, 'forward', 'bezier', 'now', 'now'),
			(203, 1, 103, 104, 'important', 'forward', 'bezier', 'now', 'now');
	`); err != nil {
		t.Fatal(err)
	}
}

func TestDensityValidationAndOverrideClamping(t *testing.T) {
	sqliteStore := openAdapterTestStore(t)
	ctx := context.Background()

	if err := sqliteStore.SetViewDensityLevel(ctx, 1, -3); err == nil {
		t.Fatal("expected invalid density to fail")
	}
	if err := sqliteStore.SetViewDensityLevel(ctx, 1, 2); err != nil {
		t.Fatal(err)
	}
	level, err := sqliteStore.ViewDensityLevel(ctx, 1)
	if err != nil {
		t.Fatal(err)
	}
	if level != 2 {
		t.Fatalf("density = %d, want 2", level)
	}

	override, err := sqliteStore.SetVisibilityOverride(ctx, 1, "element", 1, 99)
	if err != nil {
		t.Fatal(err)
	}
	if override.LevelDelta != 4 {
		t.Fatalf("delta = %d, want clamp to 4", override.LevelDelta)
	}
	override, err = sqliteStore.SetVisibilityOverride(ctx, 1, "element", 1, 0)
	if err != nil {
		t.Fatal(err)
	}
	if override.LevelDelta != 0 {
		t.Fatalf("reset delta = %d, want 0", override.LevelDelta)
	}
	overrides, err := sqliteStore.VisibilityOverrides(ctx, 1)
	if err != nil {
		t.Fatal(err)
	}
	if len(overrides) != 0 {
		t.Fatalf("overrides after reset = %v, want none", overrides)
	}
}

func TestDensityProjectionPromotedConnectorPullsEndpoints(t *testing.T) {
	sqliteStore := openAdapterTestStore(t)
	seedDensityView(t, sqliteStore)
	ctx := context.Background()

	if err := sqliteStore.SetViewDensityLevel(ctx, 1, -2); err != nil {
		t.Fatal(err)
	}
	content, err := sqliteStore.ProjectedViewContent(ctx, 1, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(content.Placements) != 4 {
		t.Fatalf("compact placements = %d, want soft cap 4", len(content.Placements))
	}
	if containsConnector(content.Connectors, 202) {
		t.Fatal("connector 202 should be outside the compact projection before override")
	}

	if _, err := sqliteStore.AdjustVisibilityOverride(ctx, 1, "connector", 202, 1); err != nil {
		t.Fatal(err)
	}
	content, err = sqliteStore.ProjectedViewContent(ctx, 1, nil)
	if err != nil {
		t.Fatal(err)
	}
	if !containsConnector(content.Connectors, 202) || !containsPlacement(content.Placements, 105) || !containsPlacement(content.Placements, 106) {
		t.Fatalf("promoted connector did not pull endpoint: placements=%v connectors=%v", placementIDs(content.Placements), connectorIDs(content.Connectors))
	}
}

func TestFullDensityKeepsAllExceptExplicitDemotions(t *testing.T) {
	sqliteStore := openAdapterTestStore(t)
	seedDensityView(t, sqliteStore)
	ctx := context.Background()

	if err := sqliteStore.SetViewDensityLevel(ctx, 1, 2); err != nil {
		t.Fatal(err)
	}
	if _, err := sqliteStore.AdjustVisibilityOverride(ctx, 1, "element", 102, -1); err != nil {
		t.Fatal(err)
	}
	content, err := sqliteStore.ProjectedViewContent(ctx, 1, nil)
	if err != nil {
		t.Fatal(err)
	}
	if containsPlacement(content.Placements, 102) {
		t.Fatal("demoted element should be hidden at full density")
	}
	if containsConnector(content.Connectors, 201) {
		t.Fatal("connector incident to hidden element should be hidden")
	}
}

func containsPlacement(items []app.PlacedElement, elementID int64) bool {
	for _, item := range items {
		if item.ElementID == elementID {
			return true
		}
	}
	return false
}

func containsConnector(items []app.Connector, connectorID int64) bool {
	for _, item := range items {
		if item.ID == connectorID {
			return true
		}
	}
	return false
}

func placementIDs(items []app.PlacedElement) []int64 {
	out := make([]int64, 0, len(items))
	for _, item := range items {
		out = append(out, item.ElementID)
	}
	return out
}

func connectorIDs(items []app.Connector) []int64 {
	out := make([]int64, 0, len(items))
	for _, item := range items {
		out = append(out, item.ID)
	}
	return out
}

func TestDensityProjectionPromotedSpecialElementPullsConnectorsAndEndpoints(t *testing.T) {
	sqliteStore := openAdapterTestStore(t)
	ctx := context.Background()

	// Seed elements
	if _, err := sqliteStore.DB().Exec(`
		INSERT INTO views(id, name, created_at, updated_at)
		VALUES
			(2, 'Test View 2', 'now', 'now'),
			(10, 'Structural', 'now', 'now');
		INSERT INTO elements(id, name, tags, technology_connectors, created_at, updated_at)
		VALUES
			(526, 'websocket.go', '[]', '[]', 'now', 'now'),
			(999, 'other.go', '[]', '[]', 'now', 'now');
		-- Place only 526 in view 2
		INSERT INTO placements(view_id, element_id, position_x, position_y, created_at, updated_at)
		VALUES
			(2, 526, 100, 100, 'now', 'now');
		-- Place 999 and 526 in view 10 (the repository view)
		INSERT INTO placements(view_id, element_id, position_x, position_y, created_at, updated_at)
		VALUES
			(10, 526, 100, 100, 'now', 'now'),
			(10, 999, 200, 200, 'now', 'now');
		-- Create a connector in view 10 between 526 and 999
		INSERT INTO connectors(id, view_id, source_element_id, target_element_id, label, direction, style, created_at, updated_at)
		VALUES
			(888, 10, 526, 999, 'calls', 'forward', 'bezier', 'now', 'now');
	`); err != nil {
		t.Fatal(err)
	}

	// Promote element 526 in view 2
	if _, err := sqliteStore.SetVisibilityOverride(ctx, 2, "element", 526, 1); err != nil {
		t.Fatal(err)
	}

	// Fetch ProjectedViewContent for view 2
	content, err := sqliteStore.ProjectedViewContent(ctx, 2, nil)
	if err != nil {
		t.Fatal(err)
	}

	// Verify that the connector 888 and opposite element 999 were pulled into view 2 projection!
	if !containsPlacement(content.Placements, 999) {
		t.Fatal("expected opposite element 999 to be pulled into placements projection")
	}
	if !containsConnector(content.Connectors, 888) {
		t.Fatal("expected connector 888 to be pulled into connectors projection")
	}
}

func TestDensityProjectionDependencyGroup(t *testing.T) {
	sqliteStore := openAdapterTestStore(t)
	ctx := context.Background()

	// Seed one regular element (id 301, kind "component") and one dependency-group element (id 302, kind "dependency-group")
	// and a connector (id 401) between them.
	if _, err := sqliteStore.DB().Exec(`
		INSERT INTO views(id, name, created_at, updated_at)
		VALUES (5, 'Test View 5', 'now', 'now');
		INSERT INTO elements(id, name, kind, tags, technology_connectors, created_at, updated_at)
		VALUES
			(301, 'Regular Component', 'component', '[]', '[]', 'now', 'now'),
			(302, 'Dep Group', 'dependency-group', '[]', '[]', 'now', 'now');
		INSERT INTO placements(view_id, element_id, position_x, position_y, created_at, updated_at)
		VALUES
			(5, 301, 100, 100, 'now', 'now'),
			(5, 302, 200, 200, 'now', 'now');
		INSERT INTO connectors(id, view_id, source_element_id, target_element_id, label, direction, style, created_at, updated_at)
		VALUES
			(401, 5, 301, 302, 'depends', 'forward', 'bezier', 'now', 'now');
	`); err != nil {
		t.Fatal(err)
	}

	// 1. Check at density level 2 (max density) - both elements and connector should be visible
	if err := sqliteStore.SetViewDensityLevel(ctx, 5, 2); err != nil {
		t.Fatal(err)
	}
	content, err := sqliteStore.ProjectedViewContent(ctx, 5, nil)
	if err != nil {
		t.Fatal(err)
	}
	if !containsPlacement(content.Placements, 301) {
		t.Fatal("expected regular element 301 to be visible at density 2")
	}
	if !containsPlacement(content.Placements, 302) {
		t.Fatal("expected dependency-group element 302 to be visible at density 2")
	}
	if !containsConnector(content.Connectors, 401) {
		t.Fatal("expected connector 401 to be visible at density 2")
	}

	// 2. Check at density level 1 - dependency-group element and connector should be pruned
	if err := sqliteStore.SetViewDensityLevel(ctx, 5, 1); err != nil {
		t.Fatal(err)
	}
	content, err = sqliteStore.ProjectedViewContent(ctx, 5, nil)
	if err != nil {
		t.Fatal(err)
	}
	if !containsPlacement(content.Placements, 301) {
		t.Fatal("expected regular element 301 to be visible at density 1")
	}
	if containsPlacement(content.Placements, 302) {
		t.Fatal("expected dependency-group element 302 to be pruned at density 1")
	}
	if containsConnector(content.Connectors, 401) {
		t.Fatal("expected connector 401 to be pruned at density 1")
	}

	// 3. Check that positive visibility override (+1) does NOT force dependency-group element to be shown at density level 1
	if _, err := sqliteStore.SetVisibilityOverride(ctx, 5, "element", 302, 1); err != nil {
		t.Fatal(err)
	}
	content, err = sqliteStore.ProjectedViewContent(ctx, 5, nil)
	if err != nil {
		t.Fatal(err)
	}
	if containsPlacement(content.Placements, 302) {
		t.Fatal("expected dependency-group element 302 to remain pruned at density 1 even with positive override")
	}
	if containsConnector(content.Connectors, 401) {
		t.Fatal("expected connector 401 to remain pruned at density 1 even with positive override")
	}
}
