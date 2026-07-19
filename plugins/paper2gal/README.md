# Paper2Galgame Plugin

> Turn academic papers into interactive visual novel dialogues — pure JS, zero Python dependency.

## Architecture

```
paper2gal/
├── manifest.json              # Plugin manifest (tool registration + config)
├── package.json               # npm: pdfjs-dist
├── tools/
│   ├── paper2gal_parse.js     # Tool: PDF resource → chapter chunks
│   └── paper2gal_generate.js  # Tool: chunks → LLM visual-novel script
├── lib/
│   ├── pdf-extractor.js       # pdfjs-dist text extraction
│   ├── chapter-splitter.js    # Heading detection + recursive text split
│   └── reading-mode.js        # Fast/Detailed mode filter
├── llm/                       # Hana provider discovery, credentials, protocols
├── skills/
│   └── paper2gal/
│       └── SKILL.md           # Visual novel script generation prompt
└── templates/
    └── galgame_card.html       # show_card HTML template
```

## How It Works

1. **User provides a PDF** → Agent calls `paper2gal_parse` tool
2. **Tool extracts text** via pdfjs-dist (pure JS, no Python)
3. **Chapter splitter** detects section headings + splits into chunks
4. **Reading mode filter** (fast/detailed) selects relevant chunks
5. **`paper2gal_generate` follows SKILL.md prompt rules**, calls the configured Hana LLM provider, and normalizes the JSON script
6. **Agent renders card** via `show_card` with the galgame_card.html template
7. **Optional TTS** via `hanako-audio-player` plugin

## Source Projects

- **Prompt engineering** — from [gitveg/paper2gal](https://github.com/gitveg/paper2gal) (`script_engine.py`, `reading_mode.py`)
- **PDF parsing approach** — inspired by [Nova42x/paper2galgame](https://github.com/Nova42x/paper2galgame) (pdfjs-dist usage)
- **Chapter splitter** — ported from LangChain's RecursiveCharacterTextSplitter (used by gitveg)

## Configuration

| Property | Default | Description |
|---|---|---|
| `defaultReadingMode` | `detailed` | `fast` = Abstract/Method/Experiment only; `detailed` = all |
| `chunkSize` | `1400` | Max chars per chunk |
| `chunkOverlap` | `180` | Overlap between chunks |
| `maxReturnedChunks` | `30` | Safety limit; `0` keeps all filtered chunks |
| `defaultCharacter` | `奈奈` | Default script character |
| `defaultProviderId` | empty | Preferred Hana chat provider; empty auto-detects |
| `defaultModel` | empty | Preferred model; empty uses the provider's first chat model |
| `llmTemperature` | `0.7` | Generation temperature in the range 0–2 |

## Characters

| Character | Style | Self-reference |
|---|---|---|
| 奈奈 | Tsundere cat girl | 奈奈子 |
| 玲娜贝儿 | Energetic fox | 贝儿 |
| 蜡笔小新 | Mischievous 5-year-old | 小新 |

## License

MIT
