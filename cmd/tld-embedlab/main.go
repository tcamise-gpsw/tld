package main

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	assets "github.com/mertcikla/tld/v2"
	"github.com/mertcikla/tld/v2/internal/cmdutil"
	"github.com/mertcikla/tld/v2/internal/embedlab"
	"github.com/mertcikla/tld/v2/internal/localserver"
	"github.com/mertcikla/tld/v2/internal/store"
	"github.com/mertcikla/tld/v2/internal/workspace"
	"github.com/spf13/cobra"
)

func main() {
	if err := newCommand().Execute(); err != nil {
		_, _ = fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func newCommand() *cobra.Command {
	var dataDir, dbPath, host, port, repository, model, runtimePath string
	var limit int
	var openBrowser bool
	cmd := &cobra.Command{
		Use:          "tld-embedlab",
		Short:        "serve a dev-only TLD embedding explorer",
		SilenceUsage: true,
		RunE: func(cmd *cobra.Command, args []string) error {
			ctx, stop := signal.NotifyContext(cmd.Context(), syscall.SIGINT, syscall.SIGTERM)
			defer stop()
			if strings.TrimSpace(dbPath) == "" {
				cfg, err := workspace.LoadGlobalConfig()
				if err != nil {
					return err
				}
				resolved, err := workspace.ResolveDataDir(cfg, dataDir)
				if err != nil {
					return err
				}
				dbPath = localserver.DatabasePath(resolved)
			}
			sqliteStore, err := store.Open(dbPath, assets.FS)
			if err != nil {
				return fmt.Errorf("open TLD database %q: %w", dbPath, err)
			}
			defer func() { _ = sqliteStore.DB().Close() }()
			addr := embedlab.Addr(host, port)
			handler := embedlab.NewHandler(embedlab.NewStore(sqliteStore.DB()), repository, model, limit, runtimePath)
			server := &http.Server{
				Addr:              addr,
				Handler:           handler.Routes(),
				ReadHeaderTimeout: 5 * time.Second,
			}
			errCh := make(chan error, 1)
			go func() {
				errCh <- server.ListenAndServe()
			}()
			url := "http://" + addr
			_, _ = fmt.Fprintf(cmd.OutOrStdout(), "TLD EmbedLab: %s\n", url)
			_, _ = fmt.Fprintf(cmd.OutOrStdout(), "Database:     %s\n", dbPath)
			if openBrowser {
				_ = cmdutil.OpenBrowser(url)
			}
			select {
			case <-ctx.Done():
				shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
				defer cancel()
				return server.Shutdown(shutdownCtx)
			case err := <-errCh:
				if errors.Is(err, http.ErrServerClosed) {
					return nil
				}
				return err
			}
		},
	}
	cmd.Flags().StringVar(&dataDir, "data-dir", "", "directory containing the TLD SQLite database")
	cmd.Flags().StringVar(&dbPath, "db", "", "explicit TLD SQLite database path")
	cmd.Flags().StringVar(&host, "host", "127.0.0.1", "host to bind")
	cmd.Flags().StringVar(&port, "port", "8072", "port to bind")
	cmd.Flags().StringVar(&repository, "repository", "", "repository id, display name, or path suffix to inspect")
	cmd.Flags().StringVar(&model, "model", "", "embedding model id, name, or provider/name to inspect")
	cmd.Flags().StringVar(&runtimePath, "runtime-path", "", "ONNX Runtime shared library path for query embeddings")
	cmd.Flags().IntVar(&limit, "limit", 36, "default graph result limit")
	cmd.Flags().BoolVar(&openBrowser, "open", false, "open the explorer in the default browser")
	return cmd
}
