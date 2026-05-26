package watch

// SemanticSignals exposes the same cross-domain role and responsibility cues
// used for populate resource embeddings so other packages can describe code in
// the same architectural vocabulary.
func SemanticSignals(name, kind, filePath, tagsJSON string) []string {
	return embeddingSemanticSignals(name, kind, filePath, tagsJSON)
}
