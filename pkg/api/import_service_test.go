package api

import (
	"context"
	"testing"

	diagv1 "buf.build/gen/go/tldiagramcom/diagram/protocolbuffers/go/diag/v1"
	"connectrpc.com/connect"
	"github.com/google/uuid"
)

func TestImportResourcesDefaultsElementBypassNoiseGateFalse(t *testing.T) {
	workspaceID := uuid.MustParse("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")
	var applied *diagv1.ApplyPlanRequest
	store := &contractStore{
		applyPlan: func(_ context.Context, id uuid.UUID, req *diagv1.ApplyPlanRequest) (*diagv1.ApplyPlanResponse, error) {
			if id != workspaceID {
				t.Fatalf("workspace id = %s, want %s", id, workspaceID)
			}
			applied = req
			return &diagv1.ApplyPlanResponse{CreatedPlacements: []*diagv1.ElementPlacement{{ViewId: 7}}}, nil
		},
	}
	service := &ImportService{Store: store}
	requestElement := &diagv1.PlanElement{Ref: "api", Name: "API"}

	_, err := service.ImportResources(context.Background(), connect.NewRequest(&diagv1.ImportResourcesRequest{
		OrgId:    workspaceID.String(),
		Elements: []*diagv1.PlanElement{requestElement},
	}))
	if err != nil {
		t.Fatal(err)
	}
	if applied == nil || len(applied.GetElements()) != 1 {
		t.Fatalf("applied request = %+v, want one element", applied)
	}
	if applied.GetElements()[0].BypassNoiseGate == nil || applied.GetElements()[0].GetBypassNoiseGate() {
		t.Fatalf("imported bypass_noise_gate = %v, want explicit false", applied.GetElements()[0].BypassNoiseGate)
	}
	if requestElement.BypassNoiseGate != nil {
		t.Fatal("ImportResources should not mutate caller-owned plan elements")
	}
}
