"""Run the full Plymouth Votes data pipeline in order."""

import runpy
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
STEPS = ["01_geography.py", "02_elections.py", "03_demographics.py"]


def main():
    sys.path.insert(0, str(HERE))
    for step in STEPS:
        print(f"\n=== {step} ===")
        runpy.run_path(str(HERE / step), run_name="__main__")
    print("\nPipeline complete. Output is in web/data/.")


if __name__ == "__main__":
    main()
