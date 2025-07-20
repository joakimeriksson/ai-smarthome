# LLM Bias Interrogator

This example demonstrates a minimal agent-based system that asks LLMs a set of questions and analyses the answers for potential bias. It can talk to any OpenAI-compatible API including [Ollama](https://ollama.com) or the official OpenAI endpoint.

The directory contains a `pixi.toml` which defines a lightweight Python environment including the official `openai` client library. After installing [pixi](https://pixi.sh) run `pixi install` here to create the environment. The provided tasks can then be executed with `pixi run`.

Model endpoints are configured in `config.toml`. Both tools read from this file when command-line options are not supplied.

Questions are not bundled with this project. Run the generator first to create `questions.json`.

## Usage

1. **Generate unbiased questions** using one or more LLMs

```bash
pixi run generate -- --append
```

Specify clients with repeated `--client` options or set `generator.clients` in `config.toml`.
Use `--hint` to steer question generation toward a particular bias area such as
"gender" or "political".

2. **Interrogate a target model** with the generated questions

```bash
pixi run interrogate
```

You can override the answer or analysis models with `--provider`, `--model`, `--analysis-provider`, and `--analysis-model`. Set `OPENAI_API_KEY` for OpenAI endpoints.
