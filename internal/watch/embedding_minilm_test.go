package watch

import (
	"context"
	"strings"
	"testing"
)

func TestMiniLMEmbeddingConfigDefaults(t *testing.T) {
	cfg := NormalizeEmbeddingConfig(EmbeddingConfig{Provider: "local-minilm"})
	if cfg.Provider != "local-minilm" {
		t.Fatalf("provider = %q", cfg.Provider)
	}
	if cfg.Model != DefaultMiniLMModel {
		t.Fatalf("model = %q, want %q", cfg.Model, DefaultMiniLMModel)
	}
	if cfg.Dimension != DefaultMiniLMDimension {
		t.Fatalf("dimension = %d, want %d", cfg.Dimension, DefaultMiniLMDimension)
	}
	if cfg.Endpoint != "" {
		t.Fatalf("endpoint = %q, want empty", cfg.Endpoint)
	}
}

func TestMiniLMModelIDIncludesRuntimePath(t *testing.T) {
	left := (&MiniLMProvider{RuntimePath: "/opt/onnx/libonnxruntime.dylib"}).ModelID()
	right := (&MiniLMProvider{RuntimePath: "/tmp/libonnxruntime.dylib"}).ModelID()
	if left.Provider != "local-minilm" || left.Model != DefaultMiniLMModel || left.Dimension != DefaultMiniLMDimension {
		t.Fatalf("unexpected model id: %+v", left)
	}
	if left.ConfigHash == right.ConfigHash {
		t.Fatalf("config hash should distinguish runtime path")
	}
}

func TestMiniLMHealthCheckRequiresRuntimePath(t *testing.T) {
	t.Setenv("ONNXRUNTIME_LIB_PATH", "")
	cfg := NormalizeEmbeddingConfig(EmbeddingConfig{Provider: "local-minilm"})
	provider, err := NewEmbeddingProvider(cfg)
	if err != nil {
		t.Fatalf("NewEmbeddingProvider: %v", err)
	}
	_, err = provider.(HealthCheckingProvider).HealthCheck(context.Background())
	if err == nil || !strings.Contains(err.Error(), "requires ONNX Runtime") {
		t.Fatalf("HealthCheck error = %v, want ONNX Runtime guidance", err)
	}
}
