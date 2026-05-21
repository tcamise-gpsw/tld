package python

import (
	"regexp"
	"strings"

	"github.com/mertcikla/tld/v2/internal/watch/enrich"
)

type ActivationSignal = enrich.ActivationSignal
type Enricher = enrich.Enricher
type RoutePattern = enrich.RoutePattern

const (
	SignalDependency = enrich.SignalDependency
	SignalImport     = enrich.SignalImport
)

func PythonFlask() Enricher {
	return enrich.RouteRegexEnricher("python.flask", "Python Flask routes", "python", []ActivationSignal{
		{Kind: SignalImport, Value: "flask"},
		{Kind: SignalDependency, Value: "flask"},
	}, []*RoutePattern{
		{Re: regexp.MustCompile(`@(?:[A-Za-z_][A-Za-z0-9_]*\.)?route\(\s*["']([^"']+)["']([^)]*)\)`), FactType: "http.route", Framework: "flask", Tags: []string{"http:route", "framework:flask"}, Custom: flaskRouteValues},
	})
}

func flaskRouteValues(match []string) (string, map[string]string, []string) {
	routePath := ""
	if len(match) > 1 {
		routePath = match[1]
	}
	attrs := map[string]string{"framework": "flask", "path": routePath}
	if method := flaskRouteMethod(match); method != "" {
		attrs["method"] = method
		return method + " " + routePath, attrs, []string{"http:route", "framework:flask"}
	}
	return routePath, attrs, []string{"http:route", "framework:flask"}
}

func flaskRouteMethod(match []string) string {
	if len(match) < 3 {
		return ""
	}
	args := match[2]
	methodsIndex := strings.Index(args, "methods")
	if methodsIndex < 0 {
		return ""
	}
	args = args[methodsIndex:]
	for _, method := range []string{"GET", "POST", "PUT", "DELETE", "PATCH"} {
		if strings.Contains(strings.ToUpper(args), `"`+method+`"`) || strings.Contains(strings.ToUpper(args), `'`+method+`'`) {
			return method
		}
	}
	return ""
}

func PythonFastAPI() Enricher {
	return enrich.RouteRegexEnricher("python.fastapi", "Python FastAPI routes", "python", []ActivationSignal{
		{Kind: SignalImport, Value: "fastapi"},
		{Kind: SignalDependency, Value: "fastapi"},
	}, []*RoutePattern{
		{Re: regexp.MustCompile(`@(?:[A-Za-z_][A-Za-z0-9_]*\.)?(get|post|put|delete|patch)\(\s*["']([^"']+)["']`), FactType: "http.route", Framework: "fastapi", MethodGroup: 1, PathGroup: 2, Tags: []string{"http:route", "framework:fastapi"}},
	})
}

func PythonDjango() Enricher {
	return enrich.RouteRegexEnricher("python.django", "Python Django routes", "python", []ActivationSignal{
		{Kind: SignalImport, Value: "django"},
		{Kind: SignalDependency, Value: "django"},
	}, []*RoutePattern{
		{Re: regexp.MustCompile(`\bpath\(\s*["']([^"']+)["']`), FactType: "http.route", Framework: "django", Tags: []string{"http:route", "framework:django"}},
		{Re: regexp.MustCompile(`\bre_path\(\s*["']([^"']+)["']`), FactType: "http.route", Framework: "django", Tags: []string{"http:route", "framework:django"}},
	})
}

func PythonStarlette() Enricher {
	return enrich.RouteRegexEnricher("python.starlette", "Python Starlette routes", "python", []ActivationSignal{
		{Kind: SignalImport, Value: "starlette"},
		{Kind: SignalDependency, Value: "starlette"},
	}, []*RoutePattern{
		{Re: regexp.MustCompile(`\bRoute\(\s*["']([^"']+)["']`), FactType: "http.route", Framework: "starlette", Tags: []string{"http:route", "framework:starlette"}},
	})
}
