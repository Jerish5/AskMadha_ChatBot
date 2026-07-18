# Bible Bot v7

An AI-powered bilingual Bible Chatbot that allows users to query and search both English and Tamil Bible texts. It uses the Google Gemini API for intelligent semantic search, language detection, and response generation, returning accurate answers with biblical references.

## Project Structure

```
bible_bot_v7/
├── backend/                        # Unified Bible API (port 3001)
│   ├── server.js                   # Express server — loads both bibles, routes by language
│   ├── .env                        # Gemini API key
│   ├── package.json
│   └── src/services/
│       ├── englishSearch.js        # English search, language detection, LLM reference finder
│       ├── bibleSearch.js          # Tamil TF-IDF search engine
│       └── chatService.js          # Tamil Gemini response generator (RC terminology)
├── data/
│   ├── english_bible/
│   │   └── English_bible_full.json
│   └── tamil_bible/
│       ├── tamil_bible_full.json
│       └── TNBCLC-BSI/             # Source SFM files for Tamil Bible
├── frontend/                       # React + Vite UI (port 5173)
└── start.bat                       # One-click launcher for Windows
```

## How It Works

1. The user types a query in English or Tamil (or Tanglish — Tamil written in English letters).
2. The backend detects the language using Gemini.
3. **English queries** — searched against the English Bible using IDF-weighted keyword scoring plus LLM semantic reference finding, then answered by Gemini.
4. **Tamil / Tanglish queries** — Tanglish is first converted to Tamil script, then searched using the Tamil TF-IDF engine with morphological suffix stripping and thematic expansion; Gemini generates a response using Roman Catholic Tamil terminology.
5. The answer and relevant Bible verses are returned to the frontend.

## Prerequisites

- [Node.js](https://nodejs.org/) v18 or higher
- npm

## Installation

```bash
# Install backend dependencies
cd backend
npm install

# Install frontend dependencies
cd ../frontend
npm install
```

## Environment Variables

The `backend/.env` file is already included. If you need to replace the API key:

```env
GEMINI_API_KEY=your_gemini_api_key_here
```

## Running the Application (Windows)

Double-click `start.bat` in the root directory, or run from the command prompt / PowerShell:

```powershell
.\start.bat
```

> [!WARNING]
> If you are using Windows PowerShell, you **must** include `.\` before `start.bat` (i.e. `.\start.bat`). If you simply type `start.bat`, PowerShell will throw an error and the servers will not start.


Two terminal windows will open:
- **Bible Chatbot API** on `http://localhost:3001`
- **Frontend Dev Server** on `http://localhost:5173`

Open your browser at **http://localhost:5173** to use the chatbot.

## Tech Stack

- **Backend**: Node.js, Express.js (ESM)
- **Frontend**: React, Vite
- **AI**: Google Gemini API — `gemini-2.5-flash` (`@google/generative-ai`)
- **Tamil Search**: Custom TF-IDF engine with morphological suffix stripping, bigram matching, thematic keyword expansion
- **English Search**: IDF-weighted keyword scoring with context smoothing and synonym expansion
