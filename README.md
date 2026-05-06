# 🕹️ Tic-Tac (Multiplayer Tic-Tac-Toe)

[![GitHub release (latest by date)](https://img.shields.io/github/v/release/dk3yyyy/tic_tac)](https://github.com/dk3yyyy/tic_tac/releases)
[![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)](https://opensource.org/licenses/ISC)
[![React](https://img.shields.io/badge/Frontend-React%2019-blue?logo=react)](https://react.dev/)
[![Node.js](https://img.shields.io/badge/Backend-Node.js-green?logo=nodedotjs)](https://nodejs.org/)

A premium, modern Tic-Tac-Toe game featuring real-time multiplayer, a built-in economy system, and an AI opponent. Designed with a sleek glassmorphism UI and powered by Socket.io and SQLite.

## ✨ Features

- **🎮 Game Modes**:
  - **Singleplayer**: Battle against an AI with multiple difficulty levels (Easy to Impossible).
  - **Multiplayer**: Host private rooms or join strangers for a competitive match.
- **💎 Economy & Shop**:
  - Earn XP and coins by winning matches.
  - Exchange tokens for gems to purchase exclusive avatars from the shop.
  - GDPR-compliant data export and account deletion.
- **📱 Modern UI**: Fully responsive design with dark/light modes, smooth animations (Framer Motion), and celebratory confetti.

## 🚀 Getting Started

### Prerequisites
- [Node.js](https://nodejs.org/) (v18 or higher)
- npm or yarn

### Installation

1. **Clone the repository**:
   ```bash
   git clone https://github.com/dk3yyyy/tic_tac.git
   cd tic_tac
   ```

2. **Install dependencies**:
   ```bash
   npm install
   cd server && npm install && cd ..
   ```

3. **Set up environment variables**:
   Create a `.env` file in the `server/` directory based on `.env.example`:
   ```bash
   cp server/.env.example server/.env
   ```

### Running the App

Start both the frontend and backend simultaneously:
```bash
npm run dev:all
```

- **Frontend**: [http://localhost:5173](http://localhost:5173)
- **Backend**: [http://localhost:3000](http://localhost:3000)

## 🛠️ Tech Stack

- **Frontend**: React 19, Vite, Framer Motion, Lucide React, Axios, Socket.io-client.
- **Backend**: Node.js, Express 5, Socket.io, Better-SQLite3, Dotenv.
- **Database**: SQLite (local persistence).

## 📄 License

This project is licensed under the ISC License.

---
Created with ❤️ by [dk3yyyy](https://github.com/dk3yyyy)
