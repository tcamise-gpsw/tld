package app

import (
	"fmt"
	"testing"
)

func TestProjectViewContentIsMonotonicAcrossDensityLevels(t *testing.T) {
	placements := make([]PlacedElement, 0, 40)
	for id := int64(1); id <= 40; id++ {
		placements = append(placements, densityTestPlacement(id))
	}
	connectors := make([]Connector, 0, 39)
	for id := int64(1); id <= 39; id++ {
		connectors = append(connectors, densityTestConnector(id, id, id+1))
	}
	overrides := []VisibilityOverride{}
	for id := int64(5); id <= 14; id++ {
		overrides = append(overrides, densityTestGate(id, -1))
	}
	for id := int64(15); id <= 24; id++ {
		overrides = append(overrides, densityTestGate(id, 1))
	}

	previous := ProjectViewContent(placements, connectors, overrides, MinDensityLevel, EmptyDensitySignals())
	for level := MinDensityLevel + 1; level <= MaxDensityLevel; level++ {
		next := ProjectViewContent(placements, connectors, overrides, level, EmptyDensitySignals())
		assertPlacementSubset(t, placementIDSet(previous.Placements), placementIDSet(next.Placements), level-1, level)
		assertConnectorSubset(t, connectorIDSet(previous.Connectors), connectorIDSet(next.Connectors), level-1, level)
		previous = next
	}
}

func TestProjectViewContentBypassNoiseGateDoesNotConsumeElementCap(t *testing.T) {
	placements := make([]PlacedElement, 0, 6)
	for id := int64(1); id <= 6; id++ {
		placement := densityTestPlacement(id)
		if id == 6 {
			placement.BypassNoiseGate = true
		}
		placements = append(placements, placement)
	}

	content := ProjectViewContent(placements, nil, nil, MinDensityLevel, EmptyDensitySignals())
	if len(content.Placements) != 5 {
		t.Fatalf("placements = %d, want cap 4 plus bypass element; ids=%v", len(content.Placements), sortedIDs(placementIDSet(content.Placements)))
	}
	if !containsDensityPlacement(content.Placements, 6) {
		t.Fatalf("bypass element missing from compact projection: ids=%v", sortedIDs(placementIDSet(content.Placements)))
	}
}

func TestProjectViewContentBypassNoiseGateIgnoresElementOverrideUntilDisabled(t *testing.T) {
	bypassed := densityTestPlacement(1)
	bypassed.BypassNoiseGate = true
	gateToFull := []VisibilityOverride{densityTestGate(1, 2)}

	content := ProjectViewContent([]PlacedElement{bypassed}, nil, gateToFull, MinDensityLevel, EmptyDensitySignals())
	if !containsDensityPlacement(content.Placements, 1) {
		t.Fatal("bypass element should ignore an element visibility override")
	}

	bypassed.BypassNoiseGate = false
	content = ProjectViewContent([]PlacedElement{bypassed}, nil, gateToFull, MinDensityLevel, EmptyDensitySignals())
	if containsDensityPlacement(content.Placements, 1) {
		t.Fatal("element visibility override should apply again when bypass is disabled")
	}
}

func FuzzProjectViewContentPlacementsAreMonotonicAcrossDensityLevels(f *testing.F) {
	f.Add([]byte{14, 0, 0, 0, 0, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2})
	f.Add([]byte{40, 1, 5, 9, 13, 17, 21, 25, 29, 33})
	f.Add([]byte{72, 255, 128, 64, 32, 16, 8, 4, 2, 1})

	f.Fuzz(func(t *testing.T, data []byte) {
		if len(data) == 0 {
			return
		}
		placements, overrides := fuzzDensityInputs(data)
		if len(placements) == 0 {
			return
		}

		previousLevel := MinDensityLevel
		previousSet := placementIDSet(ProjectViewContent(placements, nil, overrides, previousLevel, EmptyDensitySignals()).Placements)
		for level := previousLevel + 1; level <= MaxDensityLevel; level++ {
			nextSet := placementIDSet(ProjectViewContent(placements, nil, overrides, level, EmptyDensitySignals()).Placements)
			assertPlacementSubset(t, previousSet, nextSet, previousLevel, level)
			previousLevel = level
			previousSet = nextSet
		}
	})
}

func fuzzDensityInputs(data []byte) ([]PlacedElement, []VisibilityOverride) {
	count := 1 + int(data[0]%80)
	placements := make([]PlacedElement, 0, count)
	overrides := make([]VisibilityOverride, 0, count)
	for index := 0; index < count; index++ {
		id := int64(index + 1)
		kindByte := data[(index*2+1)%len(data)]
		var kind *string
		if kindByte%19 == 0 {
			kind = ptrString("dependency-group")
		}
		placements = append(placements, PlacedElement{
			ID:        id,
			ElementID: id,
			Name:      fmt.Sprintf("Element %d", id),
			Kind:      kind,
		})

		gateByte := data[(index*2+2)%len(data)]
		switch gateByte % 5 {
		case 1:
			overrides = append(overrides, densityTestGate(id, -2))
		case 2:
			overrides = append(overrides, densityTestGate(id, -1))
		case 3:
			overrides = append(overrides, densityTestGate(id, 1))
		case 4:
			overrides = append(overrides, densityTestGate(id, 2))
		}
	}
	return placements, overrides
}

func densityTestPlacement(id int64) PlacedElement {
	return PlacedElement{
		ID:        id,
		ElementID: id,
		Name:      fmt.Sprintf("Element %d", id),
	}
}

func densityTestConnector(id, sourceID, targetID int64) Connector {
	return Connector{
		ID:              id,
		SourceElementID: sourceID,
		TargetElementID: targetID,
	}
}

func densityTestGate(elementID int64, level int) VisibilityOverride {
	return VisibilityOverride{
		ResourceType: "element",
		ResourceID:   elementID,
		LevelDelta:   -level,
	}
}

func placementIDSet(placements []PlacedElement) map[int64]struct{} {
	out := make(map[int64]struct{}, len(placements))
	for _, placement := range placements {
		out[placement.ElementID] = struct{}{}
	}
	return out
}

func connectorIDSet(connectors []Connector) map[int64]struct{} {
	out := make(map[int64]struct{}, len(connectors))
	for _, connector := range connectors {
		out[connector.ID] = struct{}{}
	}
	return out
}

func containsDensityPlacement(items []PlacedElement, elementID int64) bool {
	for _, item := range items {
		if item.ElementID == elementID {
			return true
		}
	}
	return false
}

func assertPlacementSubset(t *testing.T, lower, higher map[int64]struct{}, lowerLevel, higherLevel int) {
	t.Helper()
	for id := range lower {
		if _, ok := higher[id]; !ok {
			t.Fatalf("density %d placement set is not a subset of density %d: missing element %d; lower=%v higher=%v", lowerLevel, higherLevel, id, sortedIDs(lower), sortedIDs(higher))
		}
	}
}

func assertConnectorSubset(t *testing.T, lower, higher map[int64]struct{}, lowerLevel, higherLevel int) {
	t.Helper()
	for id := range lower {
		if _, ok := higher[id]; !ok {
			t.Fatalf("density %d connector set is not a subset of density %d: missing connector %d; lower=%v higher=%v", lowerLevel, higherLevel, id, sortedIDs(lower), sortedIDs(higher))
		}
	}
}

func sortedIDs(values map[int64]struct{}) []int64 {
	out := make([]int64, 0, len(values))
	for id := range values {
		out = append(out, id)
	}
	for i := 1; i < len(out); i++ {
		for j := i; j > 0 && out[j-1] > out[j]; j-- {
			out[j-1], out[j] = out[j], out[j-1]
		}
	}
	return out
}

func ptrString(value string) *string {
	return &value
}
