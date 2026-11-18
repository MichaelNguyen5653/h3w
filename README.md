<h1 align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/readme/banner-dark.svg">
    <img src="assets/readme/banner-light.svg" width="100%" alt="h3w: fewer tokens in, fewer tokens out, same answers.">
  </picture>
</h1>

> **h3w** is a personal fork of [Chisle](https://github.com/JayPokale/Chisle) by Jay Pokale, with tighter reply formatting. It is not published to npm. Install it from this repository.

<p align="center">
  <a href="https://github.com/MichaelNguyen5653/h3w/stargazers"><img src="https://img.shields.io/github/stars/MichaelNguyen5653/h3w?style=flat-square&color=d78a3c&label=stars" alt="GitHub stars"></a>
  <img src="https://img.shields.io/badge/agents-13-d78a3c?style=flat-square" alt="Works with 13 agents">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-d78a3c?style=flat-square" alt="MIT license"></a>
  <a href="https://github.com/JayPokale"><img src="https://img.shields.io/github/followers/JayPokale?style=flat-square&logo=github&color=d78a3c&label=follow%20%40JayPokale" alt="Follow @JayPokale on GitHub"></a>
  <a href="https://buymeacoffee.com/jaypokale3b"><img src="https://img.shields.io/badge/Buy%20me%20a%20coffee-FFDD00?style=flat-square&logo=buymeacoffee&logoColor=black" alt="Buy me a coffee"></a>
</p>

<p align="center">
  <sub><b>English</b> &middot; <a href="i18n/README.es.md">Español</a> &middot; <a href="i18n/README.ko.md">한국어</a> &middot; <a href="i18n/README.zh-CN.md">简体中文</a> &middot; <a href="i18n/README.ja.md">日本語</a></sub>
</p>

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/readme/stats-dark.svg">
    <img src="assets/readme/stats-light.svg" width="880" alt="h3w versus the same model with no ruleset: 29% fewer billed output tokens, answers 45% shorter, oversized tool output 48% smaller, accuracy 156 of 156 versus 154 of 156.">
  </picture>
</p>

<p align="center"><b>Fewer tokens than caveman and ponytail. No accuracy lost.</b></p>

```bash
npx github:MichaelNguyen5653/h3w
```

<p align="center">
  <a href="https://buymeacoffee.com/jaypokale3b">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="assets/readme/strip-dark.svg">
      <img src="assets/readme/strip-light.svg" width="880" alt="h3w is free. Its benchmarks aren't. Saved you tokens? Buy me a coffee.">
    </picture>
  </a>
</p>

<p align="center"><img src="assets/readme/line.svg" width="100%" height="4" alt=""></p>

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/readme/race-dark.svg">
    <img src="assets/readme/race-light.svg" width="880" alt="Same prompt, four rulesets, visible answer tokens: h3w 530, caveman 604, ponytail 747, no ruleset 1,186. h3w is 55% shorter than no ruleset.">
  </picture>
</p>

<details>
<summary><b>See both answers</b></summary>
<br>

The prompt: *"Implement an order state machine covering created, paid, shipped, delivered, cancelled and refunded, with the legal transitions enforced and invalid ones rejected."* Excerpts from the verbatim committed answers in [`raw-nov-sidebyside/large-s2`](benchmarks/results/raw-nov-sidebyside/large-s2/):

<table>
<tr><th align="left" width="50%">no ruleset: 121 lines, 1,186 answer tokens</th><th align="left" width="50%">h3w: 62 lines, 530 answer tokens</th></tr>
<tr valign="top"><td>

```python
class OrderStateError(Exception):
    """Raised when an invalid state transition is attempted."""
    pass

class Order:
    # Define valid transitions: state -> list of allowed next states
    VALID_TRANSITIONS = { … }
    def transition_to(self, next_state):
        """Transition to the next state. Raises OrderStateError if invalid."""
    def can_transition_to(self, next_state):
        """Check if a transition is allowed without performing it."""
```

…plus usage, tests, printed output and a recap of the transitions.

</td><td>

```python
class OrderStateMachine:
    TRANSITIONS = {
        "created": {"pay", "cancel"},
        "paid": {"ship", "refund", "cancel"},
        …
    }
    def transition(self, event):
        if event not in self.TRANSITIONS[self.state]:
            raise ValueError(f"Cannot {event} from {self.state}. …")
        self.state = self.STATE_MAP[(self.state, event)]
        return self.state
```

Then a short usage block.

</td></tr>
</table>

</details>

<p align="center"><img src="assets/readme/line.svg" width="100%" height="4" alt=""></p>

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/benchmark.svg">
    <img src="assets/benchmark-light.svg" width="860" alt="Claude Code benchmark, 25 tasks in one run, billed output tokens as percent of the same model with no ruleset. caveman 87%, ponytail 90%, h3w 3.8.1 75%, h3w 71%.">
  </picture>
</p>

<p align="center"><sub>Every raw transcript is committed, losses included. <a href="docs/benchmarks.md">Method and data</a> · <a href="https://jaypokale.me/writing/h3w-benchmarks-it-loses">why we publish the losses</a></sub></p>

<p align="center"><img src="assets/readme/line.svg" width="100%" height="4" alt=""></p>

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/readme/trim-dark.svg">
    <img src="assets/readme/trim-light.svg" width="880" alt="Animated illustration of the h3w tool-output compressor: raw npm test output with colour codes, six identical lines and 172 passing lines becomes a short version with the codes stripped, the repeats collapsed, the middle elided with the full output saved to a file, and the failing test and its error kept.">
  </picture>
</p>

<p align="center"><img src="assets/readme/line.svg" width="100%" height="4" alt=""></p>

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/readme/ladder-dark.svg">
    <img src="assets/readme/ladder-light.svg" width="880" alt="The h3w efficiency ladder. Before writing code, stop at the first rung that holds: 1 does this need to exist at all, 2 already in this codebase, 3 does the stdlib do it, 4 a native platform feature, 5 an already-installed dependency, 6 can it be one line, 7 only then the minimum code that works.">
  </picture>
</p>

<p align="center"><img src="assets/readme/line.svg" width="100%" height="4" alt=""></p>

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/readme/install-dark.svg">
    <img src="assets/readme/install-light.svg" width="880" alt="Animated terminal: npx github:MichaelNguyen5653/h3w detects Claude Code, Gemini CLI, Codex, OpenCode, Copilot CLI and Cursor, installs into each, and prints Done.">
  </picture>
</p>

<details>
<summary><b>Other ways to install</b></summary>
<br>

```bash
# Claude Code plugin marketplace
claude plugin marketplace add MichaelNguyen5653/h3w
claude plugin install h3w@h3w

# curl
curl -fsSL https://raw.githubusercontent.com/MichaelNguyen5653/h3w/main/install.sh | bash
```

```powershell
# Windows
irm https://raw.githubusercontent.com/MichaelNguyen5653/h3w/main/install.ps1 | iex
```

Per-agent setup, upgrading and config: [docs/usage.md](docs/usage.md).

</details>

<p align="center"><img src="assets/readme/line.svg" width="100%" height="4" alt=""></p>

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/readme/commands-dark.svg">
    <img src="assets/readme/commands-light.svg" width="880" alt="Cheat sheet: npx github:MichaelNguyen5653/h3w wires every agent; --dry-run previews; --uninstall puts everything back; /h3w off pauses it; /h3w-review finds over-engineering; /h3w-audit finds bloated code and prose; npx github:MichaelNguyen5653/h3w tools shows tool schemas you pay for but never use; npx github:MichaelNguyen5653/h3w mcp wrap trims MCP output in any agent.">
  </picture>
</p>

<p align="center"><img src="assets/readme/line.svg" width="100%" height="4" alt=""></p>

<p align="center">
  <a href="https://www.star-history.com/?repos=MichaelNguyen5653%2Fh3w&type=date&legend=top-left">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=MichaelNguyen5653%2Fh3w&type=date&legend=top-left&theme=dark">
      <img src="https://api.star-history.com/svg?repos=MichaelNguyen5653%2Fh3w&type=date&legend=top-left" width="800" alt="GitHub stars over time">
    </picture>
  </a>
</p>

<p align="center"><img src="assets/readme/line.svg" width="100%" height="4" alt=""></p>

<p align="center">
  <a href="https://buymeacoffee.com/jaypokale3b">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="assets/readme/support-dark.svg">
      <img src="assets/readme/support-light.svg" width="880" alt="h3w is free. Its benchmarks aren't. Every benchmark run costs real API money. Saved you tokens? Buy me a coffee.">
    </picture>
  </a>
</p>

<p align="center"><a href="https://github.com/MichaelNguyen5653/h3w/stargazers">⭐ Star the repo</a>: it costs zero tokens. · <a href="https://github.com/JayPokale">Follow @JayPokale</a> for more tools.</p>

<p align="center">
  <a href="https://github.com/MichaelNguyen5653/h3w/graphs/contributors"><img src="https://contrib.rocks/image?repo=MichaelNguyen5653/h3w" alt="Contributors"></a>
</p>

<p align="center"><sub><a href="LICENSE">MIT</a> · <a href="CONTRIBUTING.md">Contributing</a> · Began as a merge of <a href="https://github.com/JuliusBrussee/caveman">caveman</a> and <a href="https://github.com/DietrichGebert/ponytail">ponytail</a> (<a href="NOTICE">notices</a>)</sub></p>
