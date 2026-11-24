# DreamMotion AI

Prompt-to-video web app using Runway's API, with an Express backend proxy that keeps the API key server-side.

## Deploy on Render
1. Upload this folder to a GitHub repository.
2. On Render, create a **Web Service** from that repository.
3. Build command: `npm install`; Start command: `npm start`.
4. Add environment variable `RUNWAY_API_KEY` in Render's Environment settings (never put it in browser code or commit it).
5. Deploy. The app uses `PORT` supplied by Render.

## Notes
- This starter uses Runway API endpoint `/v1/text_to_video`, model `gen4_turbo`, and version header `2024-11-06`. Confirm current endpoint/model/version/duration/ratio compatibility in the Runway developer documentation before production use.
- Runway API video generation requires an account, API key, and paid credits; Render free hosting availability and limits may change.
