# KQA-desktop
Versão executável do site KQA para Quality Analyzers
=======
# KQA Desktop v2.0

App desktop profissional para o sistema KQA, com mini-mode, persistência local, integração com Artia e guia de atalhos.

---

## O que há de novo na v2

- **Mini-mode** — janela flutuante compacta (420×600), sempre na frente, mesma sessão da janela principal
- **Persistência de sessão** — login, dados preenchidos e estado do site são mantidos entre reinicializações
- **Dados locais com electron-store** — salva ambientes, templates e configurações em arquivo local
- **Janela de atalhos** — guia visual completa acessível por `Ctrl + /` ou pelo menu Ajuda
- **Atalhos globais** — funcionam mesmo com o app minimizado ou em segundo plano
- **Integração com Artia** — abre o Artia pelo menu ou atalho `Ctrl + Shift + A`
- **Tray (bandeja do sistema)** — acesso rápido ao mini-mode, Artia e atalhos sem abrir a janela principal

---

## Instalação

### Pré-requisitos
- [Node.js 18+](https://nodejs.org/)

### Passos

```bash
# 1. Extraia o zip em uma pasta, ex: C:\KQA-Desktop\

# 2. Abra o CMD ou PowerShell nessa pasta e instale as dependências
npm install

# 3. Rode o app
npm start
```

---

## Gerar instalador .exe

```bash
npm run build:win
```

O instalador aparece em `dist/`. Funciona em qualquer Windows sem Node.js.

---

## Atalhos de teclado

### Globais (funcionam mesmo com o app minimizado)

| Atalho | Ação |
|--------|------|
| `Ctrl + Shift + K` | Trazer KQA à frente |
| `Ctrl + Shift + M` | Abrir / fechar Mini-mode |
| `Ctrl + Shift + H` | Abrir guia de atalhos |

### Dentro do app

| Atalho | Ação |
|--------|------|
| `F5` | Recarregar |
| `Ctrl + Shift + R` | Forçar recarregar |
| `F11` | Tela cheia |
| `F12` | DevTools |
| `Ctrl + =` | Aumentar zoom |
| `Ctrl + -` | Diminuir zoom |
| `Ctrl + 0` | Zoom padrão |
| `Ctrl + /` | Guia de atalhos |
| `Ctrl + Shift + A` | Abrir Artia |
| `Ctrl + Shift + O` | Abrir KQA no navegador |

---

## Mini-mode

Janela compacta de 420×600px que fica **sempre na frente** de outras janelas.
Ideal para usar KQA enquanto trabalha no Artia ou em outra ferramenta.

- Compartilha a **mesma sessão** da janela principal (login, dados, estado)
- Tem barra de controle própria com botão "Expandir" (volta para a janela principal)
- Ativado por `Ctrl + Shift + M` ou pelo menu Modo

---

## Dados locais (electron-store)

Os dados são salvos automaticamente em:
- **Windows:** `C:\Users\<seu usuário>\AppData\Roaming\kqa-desktop\config.json`

Para abrir a pasta: menu **Ajuda → Abrir pasta de dados locais**

Dados salvos:
- Tamanho e posição da janela
- Ambientes cadastrados
- Templates de comentário QA

---

## Ícone personalizado (opcional)

1. Crie um `icon.ico` (256×256) e um `tray-icon.png` (32×32) na pasta `assets/`
2. No `main.js`, descomente a linha `// icon: path.join(...)` na criação da BrowserWindow

Sites para converter PNG → ICO: https://convertio.co/png-ico/

---

## Estrutura do projeto

```
kqa-desktop-v2/
├── main.js          ← Lógica principal (janelas, menus, IPC, atalhos)
├── preload.js       ← Bridge segura entre Electron e o site
├── package.json     ← Dependências e configuração de build
├── assets/          ← Ícones (adicionar manualmente)
│   ├── icon.ico
│   └── tray-icon.png
└── dist/            ← Gerado após npm run build:win
```

---

## Desenvolvido por

- **Karla** — QA Lead & Automation
- **Dante de Oliveira Tavares** — Estagiário de QA · Desktop v2

© 2026 - Sistema KQA
