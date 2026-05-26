package main

import (
	"fmt"
	"io/fs"
	"log"

	tld "github.com/mertcikla/tld/v2"
)

func main() {
	rootFS, err := tld.StaticFS()
	if err != nil {
		log.Fatalf("failed to get static fs: %v", err)
	}

	distFS, err := fs.Sub(rootFS, "frontend/dist")
	if err != nil {
		log.Fatalf("failed to sub frontend/dist: %v", err)
	}

	entries, err := fs.ReadDir(distFS, ".")
	if err != nil {
		log.Fatalf("failed to read dir: %v", err)
	}

	for _, e := range entries {
		fmt.Println(e.Name())
	}
}
