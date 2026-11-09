"""Validate benchmark records and render shareable charts and a Markdown report.

Requires matplotlib==3.10.8. No desktop interaction or model inference.
"""

import argparse
import json
import math
import statistics
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.ticker import MaxNLocator


def distribution(values):
    ordered = sorted(values)
    return dict(min=ordered[0], median=statistics.median(values),
                p95=ordered[math.ceil(len(values) * .95) - 1],
                max=ordered[-1], mean=statistics.mean(values))


def read_report(path):
    report = json.loads(path.read_text(encoding="utf-8"))
    assert report["schema_version"] == 2
    for sample in report["samples"]:
        assert sample["verified"] and sample["screenshot_images"] == 0
        assert sample["mcp_calls"] == (6 if sample["mode"] == "atomic" else 1)
        assert math.isfinite(sample["elapsed_ms"]) and sample["elapsed_ms"] > 0
    for mode in ("atomic", "batch"):
        warm = [s for s in report["samples"] if s["mode"] == mode and s["phase"] == "warm"]
        assert len(warm) == report["runs_per_mode"]
        assert sorted(s["pair"] for s in warm) == list(range(1, len(warm) + 1))
        summary = report["summary"][mode]
        for key, value in distribution([s["elapsed_ms"] for s in warm]).items():
            assert math.isclose(summary["elapsed_ms"][key], value, rel_tol=1e-10)
        for metric in ("mcp_calls", "request_json_chars", "request_json_bytes",
                       "response_json_chars", "response_json_bytes", "response_text_chars", "screenshot_images"):
            assert summary[metric] == statistics.median([s[metric] for s in warm])
    a, b = report["summary"]["atomic"], report["summary"]["batch"]
    for key, av, bv in (("mcp_calls_pct", a["mcp_calls"], b["mcp_calls"]),
                        ("response_text_chars_pct", a["response_text_chars"], b["response_text_chars"]),
                        ("warm_median_execution_pct", a["elapsed_ms"]["median"], b["elapsed_ms"]["median"])):
        assert math.isclose(report["reductions"][key], 100 * (av - bv) / av, rel_tol=1e-10)
    return report


def style(ax, title, ylabel):
    ax.set_title(title, loc="left", fontweight="bold", fontsize=14, pad=18)
    ax.set_ylabel(ylabel, color="#475569")
    ax.spines[["top", "right", "left"]].set_visible(False)
    ax.spines["bottom"].set_color("#CBD5E1")
    ax.tick_params(axis="both", length=0, pad=8)
    ax.grid(axis="y", color="#E2E8F0", linewidth=.7)
    ax.set_axisbelow(True)
    ax.set_ylim(bottom=0)


def render(reports, output):
    matplotlib.rcParams.update({"font.family": "DejaVu Sans", "font.size": 11,
                               "text.color": "#0F172A", "axes.labelcolor": "#475569",
                               "svg.fonttype": "none", "svg.hashsalt": "pokemon-windows-benchmark",
                               "savefig.facecolor": "white"})
    colors = {"atomic": "#3267AF", "batch": "#078776"}
    labels = ["Normal window", "35 nested groups"]
    fig, axes = plt.subplots(2, 2, figsize=(14, 10))
    fig.subplots_adjust(left=.075, right=.97, bottom=.13, top=.79, wspace=.25, hspace=.55)
    fig.text(.075, .947, "Windows automation benchmark", fontsize=25, weight="bold")
    fig.text(.075, .902, "Atomic vs batch · same six-step workflow · real MCP server and Pokémon overlay", fontsize=13, color="#475569")
    fig.text(.075, .86, "83.3% fewer calls  |  ~64.7% less result text  |  local timing remains close", fontsize=14, color="#078776", weight="bold")

    ax = axes[0, 0]
    style(ax, "Workflow latency: median and p95", "Milliseconds · lower is faster")
    for index, mode in enumerate(colors):
        positions = [x + (index - .5) * .34 for x in range(2)]
        medians = [r["summary"][mode]["elapsed_ms"]["median"] for r in reports]
        p95s = [r["summary"][mode]["elapsed_ms"]["p95"] for r in reports]
        ax.bar(positions, medians, width=.29, color=colors[mode], label=mode.title())
        for x, median, p95 in zip(positions, medians, p95s):
            ax.plot([x, x], [median, p95], color=colors[mode], linewidth=2)
            ax.plot(x, p95, marker="_", markersize=13, color=colors[mode], markeredgewidth=2)
            ax.text(x, median * .52, f"{median:.1f}", color="white", ha="center", weight="bold")
            ax.annotate(f"p95 {p95:.1f}", (x, p95), xytext=(0, 9), textcoords="offset points", ha="center", fontsize=9)
    ax.set_xticks([0, 1], labels)
    ax.set_ylim(0, max(r["summary"][m]["elapsed_ms"]["p95"] for r in reports for m in colors) * 1.23)
    ax.legend(frameon=False, loc="upper left")

    ax = axes[0, 1]
    style(ax, "Every warm latency sample (log scale)", "Milliseconds · logarithmic scale")
    values = []
    tick_labels = []
    for report, label in zip(reports, labels):
        for mode in colors:
            values.append([s["elapsed_ms"] for s in report["samples"] if s["mode"] == mode and s["phase"] == "warm"])
            tick_labels.append(f"{label}\n{mode.title()}")
    boxes = ax.boxplot(values, patch_artist=True, whis=(0, 100), widths=.48,
                       medianprops={"color": "#0F172A", "linewidth": 2})
    for index, (patch, runs) in enumerate(zip(boxes["boxes"], values)):
        color = colors["atomic" if index % 2 == 0 else "batch"]
        patch.set_facecolor(color)
        patch.set_alpha(.18)
        # Fixed deterministic spread; it changes only presentation, never measurements.
        xs = [index + 1 + (((i * 7) % 17) - 8) * .016 for i in range(len(runs))]
        ax.scatter(xs, runs, s=17, color=color, alpha=.7, zorder=3)
    ax.set_xticks([1, 2, 3, 4], tick_labels, fontsize=9)
    ax.set_yscale("log")
    ax.set_ylim(min(min(v) for v in values) * .8, max(max(v) for v in values) * 1.2)
    ticks = [100, 200, 500, 1000, 2000]
    ax.set_yticks(ticks, [str(value) for value in ticks])
    ax.minorticks_off()

    ax = axes[1, 0]
    style(ax, "MCP calls per workflow", "Calls · identical in both fixtures")
    calls = [reports[0]["summary"][mode]["mcp_calls"] for mode in colors]
    ax.bar([0, 1], calls, color=list(colors.values()), width=.55)
    for x, value in enumerate(calls):
        ax.text(x, value + .2, str(value), ha="center", weight="bold", fontsize=17)
    ax.set_xticks([0, 1], ["Atomic", "Batch"])
    ax.set_ylim(0, 7.5)
    ax.yaxis.set_major_locator(MaxNLocator(integer=True))

    ax = axes[1, 1]
    style(ax, "Median result text returned", "Characters · UTF-16 code units")
    for index, mode in enumerate(colors):
        positions = [x + (index - .5) * .34 for x in range(2)]
        chars = [r["summary"][mode]["response_text_chars"] for r in reports]
        ax.bar(positions, chars, width=.29, color=colors[mode])
        for x, value in zip(positions, chars):
            ax.text(x, value + 30, f"{value:,}", ha="center", weight="bold")
    ax.set_xticks([0, 1], labels)
    ax.set_ylim(0, max(r["summary"][m]["response_text_chars"] for r in reports for m in colors) * 1.22)

    environment = reports[0]["environment"]
    fig.text(.075, .068, f"30 paired warm runs per fixture · 120 warm workflows · each field and click independently verified · zero screenshot results", fontsize=10, color="#475569")
    fig.text(.075, .038, f"Windows {environment['os_release']} · {environment['cpu']} · Node {environment['node']} · source {reports[0]['source_revision'][:7]}", fontsize=10, color="#475569")
    fig.text(.075, .014, "Local tool timing only. AI inference, network model round trips and token/dollar savings were not measured.", fontsize=10, color="#475569")
    output.parent.mkdir(parents=True, exist_ok=True)
    for suffix in (".png", ".svg"):
        fig.savefig(output.with_suffix(suffix), dpi=160, metadata={"Date": None} if suffix == ".svg" else None)
    plt.close(fig)


def markdown(reports, paths, output):
    rows = []
    for report, label in zip(reports, ("Normal window", "35 nested groups")):
        a, b = report["summary"]["atomic"], report["summary"]["batch"]
        rows.append(f"| {label} | {a['elapsed_ms']['median']:.1f} ms | {b['elapsed_ms']['median']:.1f} ms | {a['elapsed_ms']['p95']:.1f} ms | {b['elapsed_ms']['p95']:.1f} ms | {a['response_text_chars']} → {b['response_text_chars']} |")
    env = reports[0]["environment"]
    recorded = sum(len(r["samples"]) for r in reports)
    warm = sum(r["runs_per_mode"] * 2 for r in reports)
    return f"""# Windows automation: benchmark with visuals

![Comparison of atomic and batch workflow latency, all warm samples, MCP calls and result text.]({output.with_suffix('.png').name})

Batch reduces calls from **6 to 1 (83.3%)** and returned text by about **64.7%**. Local median execution is close: batch was **{reports[0]['reductions']['warm_median_execution_pct']:.1f}%** faster in the normal fixture and **{reports[1]['reductions']['warm_median_execution_pct']:.1f}%** in the nested fixture. These small timing differences do not establish a general execution-speed improvement. Nested controls were reachable and every workflow passed verification.

| Fixture | Atomic median | Batch median | Atomic p95 | Batch p95 | Median result text characters |
| --- | ---: | ---: | ---: | ---: | ---: |
{chr(10).join(rows)}

## Method and evidence

- **30 warm runs per mode per fixture**, paired with alternating atomic/batch order. {warm} warm workflows; {recorded} recorded workflows including four first-in-session observations. Four additional verified warmups are excluded from the raw records and statistics: **{recorded + 4} successful workflows executed** in total.
- Real Windows UI Automation, MCP stdio transport and enabled Pokémon overlay. One disposable Electron fixture at a time: a normal field/button or the same controls inside 35 anonymous ARIA groups.
- Same six operations and 2,000-character per-step budgets: discover window, discover field, set a unique Unicode value, discover button, invoke once, read the field. Batch additionally checks the expected field value internally. Fixture state is independently checked over local HTTP after each workflow, outside the timer.
- Median averages the two middle values. p95 uses nearest rank. Charts include every warm latency sample and full-range whiskers; no sample or outlier is removed. The renderer recalculates statistics from the raw data and rejects mismatches.
- Timers exclude fixture/overlay launch, connection setup and independent HTTP verification. First-in-session readings are single observations with eager worker startup; they are not cold-start measurements. A compiled native worker DLL was used.
- No AI inference or network model round trips were measured. Characters are UTF-16 code units, not token counts. JSON/UTF-8 measurements exclude JSON-RPC envelopes, schemas and initialization. This fixture benchmark does not establish arbitrary-app, macOS/Linux or end-to-end AI performance.
- Electron emitted disk-cache permission diagnostics during companion startup; the overlay connected and every workflow verified successfully. Startup is outside the warm timers. No run was filtered because of its latency.

## Reproduce

Runtime source plus benchmark harness: `{reports[0]['source_revision']}`; parent implementation is merged PR #4. Raw records include SHA-256 hashes of the executed backend, compiled worker and fixture/harness files. Environment: Windows `{env['os_release']}`, `{env['cpu']}` ({env['logical_cpus']} logical processors), Node `{env['node']}`, Electron `{env['electron']}`.

Build the backend/frontend first. This machine required `PSExecutionPolicyPreference=RemoteSigned` inherited only by the build/benchmark processes; no system policy or runtime source was changed.

```powershell
$env:PSExecutionPolicyPreference = 'RemoteSigned'
npm run benchmark:windows -- --runs 30 --fixture plain --output benchmarks/results/{paths[0].name}
npm run benchmark:windows -- --runs 30 --fixture nested --output benchmarks/results/{paths[1].name}
```

To regenerate the visual, install `matplotlib==3.10.8` in your plotting environment and run:

```text
python scripts/render-windows-benchmark.py benchmarks/results/{paths[0].name} benchmarks/results/{paths[1].name} --output benchmarks/results/{output.name}
```

[Normal raw samples]({paths[0].name}) · [Normal full report]({paths[0].with_suffix('.md').name}) · [Nested raw samples]({paths[1].name}) · [Nested full report]({paths[1].with_suffix('.md').name}) · [Vector chart]({output.with_suffix('.svg').name})
"""


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("plain", type=Path)
    parser.add_argument("nested", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    paths = [args.plain, args.nested]
    reports = [read_report(path) for path in paths]
    assert [r["fixture"]["kind"] for r in reports] == ["plain", "nested"]
    assert all(r["runs_per_mode"] == 30 for r in reports), "This chart layout expects 30 runs per mode."
    assert reports[0]["source_revision"] == reports[1]["source_revision"]
    assert reports[0]["built_backend_sha256"] == reports[1]["built_backend_sha256"]
    assert reports[0]["environment"] == reports[1]["environment"]
    render(reports, args.output)
    args.output.with_suffix(".md").write_text(markdown(reports, paths, args.output), encoding="utf-8")
    print(f"Validated {sum(len(r['samples']) for r in reports)} records; wrote PNG, SVG and Markdown to {args.output.parent}")


if __name__ == "__main__":
    main()
