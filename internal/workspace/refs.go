package workspace

import (
	"fmt"
	"regexp"
	"strings"
)

const RootRef = "root"

var refPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9._-]*$`)

// ValidateRef checks a workspace resource ref. Set allowRoot for parent/view
// refs where the synthetic root view is valid.
func ValidateRef(ref string, allowRoot bool) error {
	ref = strings.TrimSpace(ref)
	if ref == "" {
		return fmt.Errorf("reference is required and cannot be empty")
	}
	if ref == RootRef {
		if allowRoot {
			return nil
		}
		return fmt.Errorf("%q is a reserved reference for the root view", RootRef)
	}
	if !refPattern.MatchString(ref) {
		return fmt.Errorf("invalid reference %q: must start with a letter or number and contain only lowercase letters, numbers, hyphens, underscores, or dots", ref)
	}
	return nil
}

func ValidateElementRef(ref string) error {
	return ValidateRef(ref, false)
}

func ValidateParentRef(ref string) error {
	return ValidateRef(ref, true)
}
