package apply_test

import (
	"testing"

	"github.com/mertcikla/tld/v2/cmd/apply"
	"github.com/mertcikla/tld/v2/internal/workspace"
)

func TestResolveTarget(t *testing.T) {
	tests := []struct {
		name     string
		cfg      workspace.Config
		override string
		want     string
		wantErr  bool
	}{
		{
			name: "anonymous auto resolves local",
			cfg:  workspace.Config{Apply: workspace.ApplyConfig{Target: "auto"}},
			want: apply.TargetLocal,
		},
		{
			name: "logged in auto resolves remote",
			cfg: workspace.Config{
				APIKey:      "key",
				WorkspaceID: "workspace",
				Apply:       workspace.ApplyConfig{Target: "auto"},
			},
			want: apply.TargetRemote,
		},
		{
			name: "override beats logged in state",
			cfg: workspace.Config{
				APIKey:      "key",
				WorkspaceID: "workspace",
				Apply:       workspace.ApplyConfig{Target: "auto"},
			},
			override: "local",
			want:     apply.TargetLocal,
		},
		{
			name:    "invalid target rejected",
			cfg:     workspace.Config{Apply: workspace.ApplyConfig{Target: "somewhere"}},
			wantErr: true,
		},
		{
			name: "cloud alias resolves remote",
			cfg: workspace.Config{
				APIKey:      "key",
				WorkspaceID: "workspace",
			},
			override: "cloud",
			want:     apply.TargetRemote,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := apply.ResolveTarget(tt.cfg, tt.override)
			if tt.wantErr {
				if err == nil {
					t.Fatal("expected error")
				}
				return
			}
			if err != nil {
				t.Fatalf("ResolveTarget: %v", err)
			}
			if got != tt.want {
				t.Fatalf("target = %q, want %q", got, tt.want)
			}
		})
	}
}
