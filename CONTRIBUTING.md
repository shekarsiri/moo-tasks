# Contributing to Moo Tasks 🐮

Thank you for your interest in contributing to **Moo Tasks**! We welcome contributions from developers and AI practitioners across the ecosystem.

---

## 🛠️ Development Setup

### Prerequisites
- **Node.js**: `v18.0.0` or higher
- **npm**: `v9.0.0` or higher

### Getting Started

1. **Fork and clone the repository**:
   ```bash
   git clone https://github.com/your-username/moo-tasks.git
   cd moo-tasks
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Run the local development server (with hot reload)**:
   ```bash
   npm run dev
   ```
   Open `http://127.0.0.1:4242` to test the Web UI.

4. **Run the test suite**:
   ```bash
   npm test
   ```

5. **Build the production bundle**:
   ```bash
   npm run build
   ```

---

## 🏛️ Project Architecture & Conventions

- **Domain Layer (`src/domain/`)**: Pure TypeScript domain models, invariants, DAG cycle detection, and file collision detectors.
- **Infrastructure Layer (`src/infrastructure/`)**: SQLite database manager (WAL mode) and repository implementations.
- **Services Layer (`src/services/`)**: High-level application use-cases (Goal lifecycle, task state machine, claim leases, verification, human collaboration).
- **MCP Server (`src/mcp/`)**: Protocol integration via `@modelcontextprotocol/sdk`.
- **Web UI (`src/ui/`)**: Ultra-lightweight Vanilla JS + Tailwind CSS + Lucide Icons + Marked.js dashboard with SSE live sync.

---

## 🧪 Testing & Code Quality

- Write unit tests for new services and invariant rules under `src/__tests__/`.
- Ensure all tests pass with `npm test` before submitting a Pull Request.
- Follow standard TypeScript and Clean Code / SOLID principles.

---

## 📬 Pull Request Guidelines

1. Create a descriptive feature branch: `git checkout -b feat/my-new-feature`.
2. Commit your changes with clear, semantic commit messages (`feat: ...`, `fix: ...`, `docs: ...`, `refactor: ...`).
3. Ensure no trailing whitespace or stray debug logs remain.
4. Push to your fork and submit a Pull Request against the `main` branch.

Thank you for making Moo Tasks better for all developers and coding agents! 🚀
