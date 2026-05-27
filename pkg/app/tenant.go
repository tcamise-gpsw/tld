package app

import (
	"context"

	"github.com/google/uuid"
)

type tenantContextKey string

const ctxKeyTenantOrgID tenantContextKey = "app_tenant_org_id"

func WithTenantOrgID(ctx context.Context, orgID uuid.UUID) context.Context {
	return context.WithValue(ctx, ctxKeyTenantOrgID, orgID)
}

func TenantOrgIDFromCtx(ctx context.Context) uuid.UUID {
	id, _ := ctx.Value(ctxKeyTenantOrgID).(uuid.UUID)
	return id
}
