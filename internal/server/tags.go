package server

import (
	"net/http"
	"net/url"

	"github.com/google/uuid"
	"github.com/mertcikla/tld/v2/internal/store"
)

func registerTagHandlers(mux *http.ServeMux, apiStore *store.APIAdapter, workspaceID uuid.UUID) {
	mux.HandleFunc("DELETE /api/tags/{name}", func(w http.ResponseWriter, r *http.Request) {
		name, err := url.PathUnescape(r.PathValue("name"))
		if err != nil || name == "" {
			writeJSONError(w, http.StatusBadRequest, "invalid tag name")
			return
		}
		if err := apiStore.DeleteTag(r.Context(), workspaceID, name); err != nil {
			writeJSONError(w, http.StatusInternalServerError, err.Error())
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})
}
