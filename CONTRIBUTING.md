# Contributing to Campus Drift Detector

Thank you for your interest in contributing to Campus Drift Detector! We welcome contributions from network engineers, software developers, and security researchers.

---

## Code of Conduct

We expect all contributors to adhere to welcoming, respectful, and professional collaboration standards across all discussions, issues, and pull requests.

---

## Development Workflow

1. **Fork & Clone**
   ```bash
   git clone https://github.com/<your-username>/campus-drift.git
   cd campus-drift
   ```

2. **Branch Naming Conventions**
   Use standard prefixes for your branch names:
   - `feat/` for new features (e.g., `feat/juniper-junos-parser`)
   - `fix/` for bug fixes (e.g., `fix/acl-regex-escaping`)
   - `docs/` for documentation updates (e.g., `docs/troubleshooting-guide`)
   - `test/` for adding or improving test coverage (e.g., `test/celery-retry-boundary`)

3. **Local Environment Setup**
   - Follow the instructions in the [Quickstart](README.md#getting-started) section of `README.md`.
   - Copy `.env.example` to `.env` and configure appropriate ports.

4. **Running Automated Tests**
   Before submitting code, ensure that the entire test suite passes:
   ```bash
   # Backend tests (118 unit & integration tests)
   pytest backend/tests

   # Frontend production build & type checks
   npm --prefix frontend run build
   ```

5. **Commit Message Format**
   We follow the [Conventional Commits](https://www.conventionalcommits.org/) specification:
   - `feat(scope): concise description of feature`
   - `fix(scope): concise description of bug fix`
   - `docs(scope): documentation changes`
   - `refactor(scope): internal code refactor without behavior changes`

6. **Submitting a Pull Request**
   - Push your branch to your GitHub fork.
   - Open a Pull Request targeting the `main` branch.
   - Provide a clear summary of your changes, the motivation, and evidence of passing tests.
