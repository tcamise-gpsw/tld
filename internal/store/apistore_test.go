package store

import (
	"context"
	"path/filepath"
	"strings"
	"testing"

	diagv1 "buf.build/gen/go/tldiagramcom/diagram/protocolbuffers/go/diag/v1"
	"github.com/google/uuid"
	assets "github.com/mertcikla/tld/v2"
	"github.com/mertcikla/tld/v2/internal/app"
	"github.com/mertcikla/tld/v2/pkg/api"
	"google.golang.org/protobuf/encoding/protojson"
)

func openAdapterTestStore(t *testing.T) *SQLiteStore {
	t.Helper()
	sqliteStore, err := Open(filepath.Join(t.TempDir(), "tld.db"), assets.FS)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = sqliteStore.Legacy().Close() })
	return sqliteStore
}

func TestElementToProtoPreservesPrimaryIconMetadata(t *testing.T) {
	technology := "JavaScript"
	element := elementToProto(app.LibraryElement{
		ID:         1,
		Name:       "Web",
		Technology: &technology,
		TechnologyConnectors: []app.TechnologyConnector{{
			Type:          "catalog",
			Slug:          "javascript",
			Label:         "JavaScript",
			IsPrimaryIcon: true,
		}},
	}, uuid.Nil)

	data, err := protojson.Marshal(element)
	if err != nil {
		t.Fatal(err)
	}
	body := string(data)
	if !strings.Contains(body, `"technology":"JavaScript"`) {
		t.Fatalf("response body = %s, want technology field", body)
	}
	if !strings.Contains(body, `"isPrimaryIcon":true`) {
		t.Fatalf("response body = %s, want primary icon metadata", body)
	}
}

func TestPlacedElementToProtoPreservesPrimaryIconMetadata(t *testing.T) {
	placement := placedElementToProto(app.PlacedElement{
		ID:        1,
		ViewID:    1,
		ElementID: 1,
		Name:      "Web",
		TechnologyConnectors: []app.TechnologyConnector{{
			Type:          "catalog",
			Slug:          "javascript",
			Label:         "JavaScript",
			IsPrimaryIcon: true,
		}},
	})

	data, err := protojson.Marshal(placement)
	if err != nil {
		t.Fatal(err)
	}
	body := string(data)
	if !strings.Contains(body, `"isPrimaryIcon":true`) {
		t.Fatalf("response body = %s, want primary icon metadata", body)
	}
}

func TestGetWorkspaceResourceCountsUsesTableCounts(t *testing.T) {
	sqliteStore := openAdapterTestStore(t)

	db := sqliteStore.DB()
	if _, err := db.Exec(`
		INSERT INTO elements(name, tags, technology_connectors, created_at, updated_at)
		VALUES
			('A', '[]', '[]', 'now', 'now'),
			('B', '[]', '[]', 'now', 'now');
		INSERT INTO views(owner_element_id, name, description, level_label, level, created_at, updated_at)
		VALUES (1, 'A view', NULL, 'Service', 2, 'now', 'now');
		INSERT INTO placements(view_id, element_id, position_x, position_y, created_at, updated_at)
		VALUES (1, 1, 0, 0, 'now', 'now'), (2, 2, 10, 10, 'now', 'now');
		INSERT INTO connectors(view_id, source_element_id, target_element_id, direction, style, created_at, updated_at)
		VALUES (1, 1, 2, 'forward', 'solid', 'now', 'now');
	`); err != nil {
		t.Fatal(err)
	}

	views, elements, connectors, err := NewAPIAdapter(sqliteStore).GetWorkspaceResourceCounts(context.Background(), uuid.Nil)
	if err != nil {
		t.Fatal(err)
	}
	if views != 2 || elements != 2 || connectors != 1 {
		t.Fatalf("counts = views:%d elements:%d connectors:%d, want 2/2/1", views, elements, connectors)
	}
}

func TestGetViewsFiltersDirectChildrenByParentViewID(t *testing.T) {
	sqliteStore := openAdapterTestStore(t)

	db := sqliteStore.DB()
	if _, err := db.Exec(`
		INSERT INTO elements(id, name, tags, technology_connectors, created_at, updated_at)
		VALUES
			(10, 'Service', '[]', '[]', 'now', 'now'),
			(11, 'Component', '[]', '[]', 'now', 'now');
		INSERT INTO views(id, owner_element_id, name, description, level_label, level, created_at, updated_at)
		VALUES
			(20, 10, 'Service view', NULL, 'Service', 2, 'now', 'now'),
			(21, 11, 'Component view', NULL, 'Component', 3, 'now', 'now');
		INSERT INTO placements(view_id, element_id, position_x, position_y, created_at, updated_at)
		VALUES
			(1, 10, 0, 0, 'now', 'now'),
			(20, 11, 10, 10, 'now', 'now');
	`); err != nil {
		t.Fatal(err)
	}

	parentID := int32(1)
	children, total, err := NewAPIAdapter(sqliteStore).GetViews(context.Background(), uuid.Nil, &parentID, nil, "", 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	if total != 1 || len(children) != 1 || children[0].GetId() != 20 {
		t.Fatalf("root children = total:%d views:%v, want only view 20", total, children)
	}

	parentID = 20
	children, total, err = NewAPIAdapter(sqliteStore).GetViews(context.Background(), uuid.Nil, &parentID, nil, "", 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	if total != 1 || len(children) != 1 || children[0].GetId() != 21 {
		t.Fatalf("nested children = total:%d views:%v, want only view 21", total, children)
	}
}

func TestApplyPlanAutoLayoutsUnpositionedPlacements(t *testing.T) {
	sqliteStore := openAdapterTestStore(t)

	resp, err := NewAPIAdapter(sqliteStore).ApplyPlan(context.Background(), uuid.Nil, &diagv1.ApplyPlanRequest{
		Elements: []*diagv1.PlanElement{
			{Ref: "api", Name: "API", Placements: []*diagv1.PlanViewPlacement{{ParentRef: "root"}}},
			{Ref: "db", Name: "DB", Placements: []*diagv1.PlanViewPlacement{{ParentRef: "root"}}},
		},
		Connectors: []*diagv1.PlanConnector{{
			Ref:              "api-db",
			ViewRef:          "root",
			SourceElementRef: "api",
			TargetElementRef: "db",
		}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(resp.GetCreatedPlacements()) != 2 {
		t.Fatalf("created placements = %d, want 2", len(resp.GetCreatedPlacements()))
	}
	first := resp.GetCreatedPlacements()[0]
	second := resp.GetCreatedPlacements()[1]
	if first.GetPositionX() == second.GetPositionX() && first.GetPositionY() == second.GetPositionY() {
		t.Fatalf("placements overlapped at (%v, %v)", first.GetPositionX(), first.GetPositionY())
	}

	rows, err := sqliteStore.DB().QueryContext(context.Background(), `SELECT position_x, position_y FROM placements ORDER BY element_id`)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = rows.Close() }()
	var positions [][2]float64
	for rows.Next() {
		var x, y float64
		if err := rows.Scan(&x, &y); err != nil {
			t.Fatal(err)
		}
		positions = append(positions, [2]float64{x, y})
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	if len(positions) != 2 || positions[0] == positions[1] {
		t.Fatalf("stored positions = %v, want distinct layout positions", positions)
	}
}

func TestApplyPlanPreservesExplicitPlacementCoordinates(t *testing.T) {
	sqliteStore := openAdapterTestStore(t)
	x, y := 42.0, 84.0

	resp, err := NewAPIAdapter(sqliteStore).ApplyPlan(context.Background(), uuid.Nil, &diagv1.ApplyPlanRequest{
		Elements: []*diagv1.PlanElement{{
			Ref:  "api",
			Name: "API",
			Placements: []*diagv1.PlanViewPlacement{{
				ParentRef: "root",
				PositionX: &x,
				PositionY: &y,
			}},
		}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(resp.GetCreatedPlacements()) != 1 {
		t.Fatalf("created placements = %d, want 1", len(resp.GetCreatedPlacements()))
	}
	placement := resp.GetCreatedPlacements()[0]
	if placement.GetPositionX() != x || placement.GetPositionY() != y {
		t.Fatalf("placement = (%v, %v), want (%v, %v)", placement.GetPositionX(), placement.GetPositionY(), x, y)
	}
}

func TestListElementsMapsSearchPaginationAndViewMetadata(t *testing.T) {
	sqliteStore := openAdapterTestStore(t)
	db := sqliteStore.DB()
	if _, err := db.Exec(`
		INSERT INTO elements(id, name, kind, description, tags, technology_connectors, created_at, updated_at)
		VALUES
			(10, 'API', 'service', 'Public runtime API', '["runtime"]', '[]', 'now', '2026-01-02T00:00:00Z'),
			(11, 'Worker', 'service', 'Background for API jobs', '["runtime"]', '[]', 'now', '2026-01-03T00:00:00Z');
		INSERT INTO views(id, owner_element_id, name, description, level_label, level, created_at, updated_at)
		VALUES (20, 10, 'API view', NULL, 'Service', 2, 'now', 'now');
	`); err != nil {
		t.Fatal(err)
	}

	items, total, err := NewAPIAdapter(sqliteStore).ListElements(context.Background(), uuid.Nil, 1, 0, "API")
	if err != nil {
		t.Fatal(err)
	}
	if total != 1 || len(items) != 1 || items[0].GetId() != 10 {
		t.Fatalf("filtered elements = total:%d items:%+v, want only API", total, items)
	}
	if !items[0].GetHasView() || items[0].GetViewLabel() != "Service" {
		t.Fatalf("view metadata = has:%v label:%q, want Service child view", items[0].GetHasView(), items[0].GetViewLabel())
	}

	items, total, err = NewAPIAdapter(sqliteStore).ListElements(context.Background(), uuid.Nil, 1, 1, "")
	if err != nil {
		t.Fatal(err)
	}
	if total != 2 || len(items) != 1 || items[0].GetId() != 10 {
		t.Fatalf("paginated elements = total:%d items:%+v, want API as second updated item", total, items)
	}
}

func TestConnectorAdapterPreservesHandlesDefaultsAndViewFiltering(t *testing.T) {
	sqliteStore := openAdapterTestStore(t)
	db := sqliteStore.DB()
	if _, err := db.Exec(`
		INSERT INTO elements(id, name, tags, technology_connectors, created_at, updated_at)
		VALUES
			(10, 'API', '[]', '[]', 'now', 'now'),
			(11, 'DB', '[]', '[]', 'now', 'now');
		INSERT INTO views(id, owner_element_id, name, description, level_label, level, created_at, updated_at)
		VALUES (20, 10, 'API view', NULL, 'Service', 2, 'now', 'now');
	`); err != nil {
		t.Fatal(err)
	}
	label := "reads"
	sourceHandle := "right"
	targetHandle := "left"
	connector, err := NewAPIAdapter(sqliteStore).CreateConnector(context.Background(), uuid.Nil, api.ConnectorInput{
		ViewID:       20,
		SourceID:     10,
		TargetID:     11,
		Label:        &label,
		Style:        "solid",
		SourceHandle: &sourceHandle,
		TargetHandle: &targetHandle,
	})
	if err != nil {
		t.Fatal(err)
	}
	if connector.GetDirection() != "forward" || connector.GetStyle() != "solid" {
		t.Fatalf("connector defaults = direction:%q style:%q, want forward/solid", connector.GetDirection(), connector.GetStyle())
	}
	if connector.GetSourceHandle() != "right" || connector.GetTargetHandle() != "left" {
		t.Fatalf("connector handles = %q/%q, want right/left", connector.GetSourceHandle(), connector.GetTargetHandle())
	}

	all, err := NewAPIAdapter(sqliteStore).ListAllConnectors(context.Background(), uuid.Nil)
	if err != nil {
		t.Fatal(err)
	}
	inView, err := NewAPIAdapter(sqliteStore).ListConnectors(context.Background(), 20, uuid.Nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(all) != 1 || len(inView) != 1 || all[0].GetId() != inView[0].GetId() {
		t.Fatalf("connector list mismatch: all=%+v inView=%+v", all, inView)
	}
}

func TestListAllViewLayersBatchesAndPreservesTreeOrder(t *testing.T) {
	sqliteStore := openAdapterTestStore(t)
	db := sqliteStore.DB()
	if _, err := db.Exec(`
		INSERT INTO elements(id, name, tags, technology_connectors, created_at, updated_at)
		VALUES (120, 'Service', '[]', '[]', 'now', 'now');
		INSERT INTO views(id, owner_element_id, name, description, level_label, level, created_at, updated_at)
		VALUES
			(120, NULL, 'System', NULL, 'System', 1, 'now', 'now'),
			(121, 120, 'Service detail', NULL, 'Service', 2, 'now', 'now');
		INSERT INTO placements(view_id, element_id, position_x, position_y, created_at, updated_at)
		VALUES (120, 120, 0, 0, 'now', 'now');
		INSERT INTO view_layers(id, view_id, name, tags, color, created_at, updated_at)
		VALUES
			(120, 120, 'Root A', '["api"]', '#111111', 'now', 'now'),
			(121, 120, 'Root B', '["db"]', '#222222', 'now', 'now'),
			(122, 121, 'Child A', '["worker"]', '#333333', 'now', 'now');
	`); err != nil {
		t.Fatal(err)
	}

	layers, err := NewAPIAdapter(sqliteStore).ListAllViewLayers(context.Background(), uuid.Nil)
	if err != nil {
		t.Fatal(err)
	}
	var names []string
	for _, layer := range layers {
		switch layer.GetId() {
		case 120, 121, 122:
			names = append(names, layer.GetName())
		}
	}
	if strings.Join(names, ",") != "Root A,Root B,Child A" {
		t.Fatalf("layer order = %v, want root layers before child layers", names)
	}
}
