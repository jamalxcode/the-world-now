<div align="center">

```
╔══════════════════════════════════════╗
║        🌍  THE WORLD NOW  🌍         ║
╚══════════════════════════════════════╝
```

### *A live window into the world, right now.*

[![GitHub Pages](https://img.shields.io/badge/deployed-GitHub%20Pages-22272e?style=for-the-badge&logo=github)](https://jamalxcode.github.io/the-world-now)
[![React](https://img.shields.io/badge/React-19.2.3-61DAFB?style=for-the-badge&logo=react)](https://react.dev)
[![HTML](https://img.shields.io/badge/Language-HTML%20100%25-E34F26?style=for-the-badge&logo=html5)](https://github.com/jamalxcode/the-world-now)
[![Status](https://img.shields.io/badge/status-live-brightgreen?style=for-the-badge)](https://jamalxcode.github.io/the-world-now)

</div>

---

## ✨ What Is This?

**The World Now** is a sleek, fast, browser-based experience built with **React 19** and bundled via **Vite**. Deployed seamlessly on **GitHub Pages**, it's designed to be instantly accessible — no installs, no accounts, just open and explore.

---

## 🗂️ Project Structure

```
the-world-now/
├── 📄 index.html               ← App entry point
├── 📄 config.json              ← Editable sources config (no rebuild needed)
├── 📁 assets/
│   ├── 🧠 index-pBGzX7_c.js   ← Bundled React app (Vite output)
│   └── 🎨 index-eCIea8pR.css  ← Compiled styles
└── 🌐 CNAME                    ← Custom domain config
```

---

## 📡 Sources & Configuration

News sources are controlled via **`config.json`** — edit it directly without rebuilding.

### Nitter / Twitter Accounts
100+ accounts across global news, finance, geopolitics, and conflict monitoring — including NYT, BBC, Reuters, AP, Al Jazeera, CNN, FRANCE24, Fox, WSJ, FT, Bloomberg, The Economist, and OSINT/conflict trackers like `OSINTdefender`, `KyivIndependent`, `sentdefender`, and more.

### Reddit Subreddits
`worldnews` · `news` · `technology` · `science` · `business` · `geopolitics`

### Nitter Instances (fallback chain)
- `https://rss.xcancel.com`
- `https://xcancel.com`
- `https://nitter.privacydev.net`

### Config Options

| Key | Default | Description |
|-----|---------|-------------|
| `nitter_sample_size` | `8` | Accounts sampled per refresh |
| `fetch_timeout_ms` | `15000` | Per-source fetch timeout |
| `target_item_count` | `80` | Total feed items to display |

---

## 🚀 Getting Started

### Prerequisites

- A modern browser (Chrome, Firefox, Safari, Edge)
- Node.js `18+` if you want to run it locally

### Run Locally

```bash
# Clone the repo
git clone https://github.com/jamalxcode/the-world-now.git
cd the-world-now

# Install dependencies (if working from source)
npm install

# Start dev server
npm run dev
```

### Build for Production

```bash
npm run build
```

> Vite will output the production-ready bundle into the `assets/` folder.

---

## 🌐 Live Demo

👉 **[jamalxcode.github.io/the-world-now](https://jamalxcode.github.io/the-world-now)**

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| ⚛️ UI Framework | React 19.2.3 |
| ⚡ Build Tool | Vite |
| 🎨 Styling | CSS (compiled) |
| 📡 Feed Sources | Nitter RSS + Reddit JSON |
| 🚀 Deployment | GitHub Pages |
| 🌐 Language | HTML / JavaScript |

---

## 📦 Deployment

This project is configured for **GitHub Pages** auto-deployment.

- A `CNAME` file is present for custom domain support
- Assets are pre-bundled — no server needed
- Deployments trigger automatically on push to `main`
- Sources can be updated via `config.json` without a rebuild

---

## 🤝 Contributing

Got an idea that'd make the world feel a little more *now*?

1. Fork the repo 🍴
2. Create your branch: `git checkout -b feature/your-idea`
3. Commit your changes: `git commit -m 'Add some magic'`
4. Push to the branch: `git push origin feature/your-idea`
5. Open a Pull Request 🚀

---

## 👤 Author

**jamalxcode**
- GitHub: [@jamalxcode](https://github.com/jamalxcode)

---

<div align="center">

*Built with ❤️ and deployed to the world.*

</div>
