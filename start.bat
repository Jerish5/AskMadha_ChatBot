@echo off
echo Starting Bible Chatbot Backend...
start "Bible Chatbot API (Port 3001)" cmd /k "cd backend && node server.js"

echo Starting Frontend Dev Server...
start "Frontend Dev (Port 5173)" cmd /k "cd frontend && npm run dev"

echo All services have been started in separate windows!
