import click
import json
import asyncio
from rich.console import Console
from rich.table import Table
from rich.panel import Panel

from visionharness.agent.planner import plan_workflow
from visionharness.core.spec import WorkflowSpec
from visionharness.runtime.engine import VisionRuntime, VideoSource

console = Console()


@click.group()
def cli():
    """VisionHarness: Agentic Computer Vision Builder."""
    pass


@cli.command()
@click.argument("prompt", type=str)
def plan(prompt: str):
    """Ask the VisionHarness AI Agent to architect a vision workflow from natural language."""
    console.print(Panel.fit(f"[bold cyan]User Prompt:[/bold cyan] {prompt}", title="VisionHarness Planner"))
    with console.status("[bold green]Agent researching components & architecting workflow..."):
        result = asyncio.run(plan_workflow(prompt))
    console.print(Panel(result, title="[bold green]Generated Workflow Architecture[/bold green]"))


@cli.command()
@click.option("--spec-path", "-s", required=True, type=click.Path(exists=True), help="Path to workflow JSON specification")
@click.option("--video-path", "-v", required=True, type=str, help="Path to input video (or RTSP url / 0 for webcam)")
@click.option("--output-path", "-o", default="output/annotated_output.mp4", help="Path to save annotated video")
@click.option("--max-frames", "-f", default=None, type=int, help="Optional max frames to process")
def run(spec_path: str, video_path: str, output_path: str, max_frames: int | None):
    """Execute a workflow specification against a video source."""
    with open(spec_path, "r") as f:
        data = json.load(f)
    spec = WorkflowSpec.model_validate(data)

    console.print(Panel.fit(f"[bold]Executing Workflow:[/bold] {spec.name} ({spec.id})\nSource: {video_path}", title="Vision Runtime"))

    source = VideoSource(0 if video_path.isdigit() else video_path)
    runtime = VisionRuntime(spec)

    with console.status("[bold yellow]Running computer vision inference pipeline..."):
        stats = runtime.process_video(source, output_video_path=output_path, max_frames=max_frames)

    table = Table(title="Execution Summary")
    table.add_column("Metric", style="cyan")
    table.add_column("Value", style="magenta")
    for k, v in stats.items():
        table.add_row(str(k), str(v))

    console.print(table)


if __name__ == "__main__":
    cli()
