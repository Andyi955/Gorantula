package legs

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"spider-agent/models"

	"github.com/google/generative-ai-go/genai"
	"google.golang.org/api/option"
)

// ExecuteMediaTask downloads and transcribes audio/video content using Gemini natively or yt-dlp fallback.
func ExecuteMediaTask(legID int, targetQuery string, broadcast models.Broadcaster) models.NutrientFlow {
	ctx := context.Background()

	apiKey := os.Getenv("GEMINI_API_KEY")
	if apiKey == "" {
		return models.NutrientFlow{LegID: legID, SourceURL: targetQuery, Error: fmt.Errorf("GEMINI_API_KEY environment variable not set")}
	}
	client, err := genai.NewClient(ctx, option.WithAPIKey(apiKey))
	if err != nil {
		return models.NutrientFlow{LegID: legID, SourceURL: targetQuery, Error: err}
	}
	defer client.Close()

	var mediaPart genai.Part
	targetLower := strings.ToLower(targetQuery)
	isYouTube := strings.Contains(targetLower, "youtube.com") || strings.Contains(targetLower, "youtu.be")

	if isYouTube {
		if broadcast != nil {
			broadcast(models.WSMessage{
				Type:    "LEG_STATE",
				Payload: fmt.Sprintf("Leg %d: Passing YouTube URL natively to Gemini...", legID),
			})
		}
		// Gemini natively supports YouTube URLs via FileData
		mediaPart = genai.FileData{URI: targetQuery}
	} else {
		if broadcast != nil {
			broadcast(models.WSMessage{
				Type:    "LEG_STATE",
				Payload: fmt.Sprintf("Leg %d: Initializing media extraction via yt-dlp for %s", legID, targetQuery),
			})
		}

		// 1. Download audio via yt-dlp
		tempDir := os.TempDir()
		fileName := fmt.Sprintf("spider_media_%d", time.Now().UnixNano())
		outputPath := filepath.Join(tempDir, fileName+".%(ext)s")

		cmd := exec.Command("yt-dlp", "-x", "--audio-format", "mp3", "-o", outputPath, "--", targetQuery)
		err := cmd.Run()
		if err != nil {
			return models.NutrientFlow{
				LegID:     legID,
				SourceURL: targetQuery,
				Error:     fmt.Errorf("yt-dlp download failed: %w", err),
			}
		}

		actualFilePath := filepath.Join(tempDir, fileName+".mp3")
		if _, err := os.Stat(actualFilePath); os.IsNotExist(err) {
			matches, _ := filepath.Glob(filepath.Join(tempDir, fileName+".*"))
			if len(matches) > 0 {
				actualFilePath = matches[0]
			} else {
				return models.NutrientFlow{
					LegID:     legID,
					SourceURL: targetQuery,
					Error:     fmt.Errorf("downloaded media file not found in temp dir"),
				}
			}
		}
		defer os.Remove(actualFilePath) // Cleanup local file

		if broadcast != nil {
			broadcast(models.WSMessage{
				Type:    "LEG_STATE",
				Payload: fmt.Sprintf("Leg %d: Uploading media to Gemini File API...", legID),
			})
		}

		// 2. Upload to Gemini
		f, err := os.Open(actualFilePath)
		if err != nil {
			return models.NutrientFlow{LegID: legID, SourceURL: targetQuery, Error: err}
		}
		defer f.Close()

		opts := &genai.UploadFileOptions{DisplayName: fileName}
		uploadedFile, err := client.UploadFile(ctx, "", f, opts)
		if err != nil {
			return models.NutrientFlow{LegID: legID, SourceURL: targetQuery, Error: fmt.Errorf("gemini upload failed: %w", err)}
		}
		defer client.DeleteFile(ctx, uploadedFile.Name) // Cleanup remote file

		if broadcast != nil {
			broadcast(models.WSMessage{
				Type:    "LEG_STATE",
				Payload: fmt.Sprintf("Leg %d: Waiting for Gemini File processing...", legID),
			})
		}

		timeoutCtx, cancel := context.WithTimeout(ctx, 10*time.Minute)
		defer cancel()
		ready := false

		for !ready {
			select {
			case <-timeoutCtx.Done():
				return models.NutrientFlow{LegID: legID, SourceURL: targetQuery, Error: fmt.Errorf("gemini file processing timed out after 10 minutes")}
			default:
				fileInfo, err := client.GetFile(ctx, uploadedFile.Name)
				if err != nil {
					return models.NutrientFlow{LegID: legID, SourceURL: targetQuery, Error: err}
				}
				if fileInfo.State == genai.FileStateActive {
					ready = true
				} else if fileInfo.State == genai.FileStateFailed {
					return models.NutrientFlow{LegID: legID, SourceURL: targetQuery, Error: fmt.Errorf("gemini file processing failed")}
				} else {
					time.Sleep(2 * time.Second)
				}
			}
		}

		mediaPart = genai.FileData{URI: uploadedFile.URI}
	}

	if broadcast != nil {
		broadcast(models.WSMessage{
			Type:    "LEG_STATE",
			Payload: fmt.Sprintf("Leg %d: Transcribing and extracting evidence from media...", legID),
		})
	}

	// 3. Prompt Gemini
	model := client.GenerativeModel("gemini-3-flash-preview")
	prompt := genai.Text("You are an expert transcriptionist and intelligence analyst. Please listen to the attached media file. First, optionally provide a brief summary of what is discussed. Then, extract ALL critical facts exactly as they are stated, focusing on details relevant to a deep dive investigation. If the content contains names, dates, amounts, or strong claims, enumerate them clearly.")

	resp, err := model.GenerateContent(ctx, mediaPart, prompt)
	if err != nil {
		return models.NutrientFlow{LegID: legID, SourceURL: targetQuery, Error: fmt.Errorf("transcription generation failed: %w", err)}
	}

	if len(resp.Candidates) == 0 || len(resp.Candidates[0].Content.Parts) == 0 {
		return models.NutrientFlow{LegID: legID, SourceURL: targetQuery, Error: fmt.Errorf("empty response from gemini transcription")}
	}

	transcriptionResult := fmt.Sprintf("%v", resp.Candidates[0].Content.Parts[0])

	return models.NutrientFlow{
		LegID:     legID,
		SourceURL: targetQuery,
		Content:   transcriptionResult,
		Error:     nil,
	}
}
