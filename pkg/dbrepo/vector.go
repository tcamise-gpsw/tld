package dbrepo

import "context"

type VectorStore interface {
	EnsureSchema(ctx context.Context) error
	Save(ctx context.Context, modelID int64, ownerType, ownerKey, inputHash string, vectorData []byte) error
	Similar(ctx context.Context, modelID int64, query []float32, limit int) ([]int64, error)
}
