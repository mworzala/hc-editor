package main

import (
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// ProjectService bridges HTTP calls from the frontend through Go to the
// project API server. Used to work around a WKWebView bug where fetch (and
// allegedly XHR) drops the body of PUT/DELETE/PATCH requests; the Go HTTP
// stack has no such issue. Routing through here also gives us a hook for
// mirroring file updates to the local disk so external editors (e.g. Aseprite
// for textures) can pick them up.
//
// The bridge uses string for body fields. Go strings hold arbitrary byte
// sequences, but they have to traverse JSON to/from the frontend. That's fine
// for text uploads (the only case we have today). Binary upload/download will
// need a base64 (or chunked) variant.
type ProjectService struct {
	BaseURL string
	client  *http.Client
}

func NewProjectService(baseURL string) *ProjectService {
	return &ProjectService{
		BaseURL: baseURL,
		client:  &http.Client{Timeout: 30 * time.Second},
	}
}

type ProjectResponse struct {
	Status      int    `json:"status"`
	StatusText  string `json:"statusText"`
	ContentType string `json:"contentType"`
	Body        string `json:"body"`
}

// Request performs an HTTP request from Go and returns the response. The
// frontend uses this for PUT/DELETE/PATCH to bypass the WKWebView body-drop
// bug. `path` is the request path including any prefix (e.g.
// "/v1/projects/demo/files/foo.txt"). `contentType` may be empty for methods
// without a body. `body` may be "" for DELETE.
func (s *ProjectService) Request(
	method string,
	path string,
	contentType string,
	body string,
) (ProjectResponse, error) {
	var reader io.Reader
	if len(body) > 0 {
		reader = strings.NewReader(body)
	}

	req, err := http.NewRequest(method, s.BaseURL+path, reader)
	if err != nil {
		return ProjectResponse{}, fmt.Errorf("build request: %w", err)
	}
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	if reader != nil {
		req.ContentLength = int64(len(body))
	}

	resp, err := s.client.Do(req)
	if err != nil {
		return ProjectResponse{}, fmt.Errorf("http request: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return ProjectResponse{}, fmt.Errorf("read response: %w", err)
	}

	return ProjectResponse{
		Status:      resp.StatusCode,
		StatusText:  resp.Status,
		ContentType: resp.Header.Get("Content-Type"),
		Body:        string(respBody),
	}, nil
}
