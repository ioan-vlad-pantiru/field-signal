"""Thin CLI dispatcher. Step logic lives in the Wave 1 modules."""
import argparse
import importlib

MODULES = {
    "step1": "hrl",
    "step2": "points",
    "step3": "gee",
    "step4": "weather",
    "manifest": "manifest",
}


def _run(args):
    try:
        module = importlib.import_module(MODULES[args.step])
    except ModuleNotFoundError as exc:
        raise SystemExit(f"{args.step}: module missing ({exc.name})")
    entry = getattr(module, "main", None)
    if entry is None:
        raise SystemExit(f"{args.step}: {MODULES[args.step]}.main(region, pilot) is not defined")
    if args.step == "step2" and getattr(args, "extend", False):
        module.extend()
    else:
        entry(region=args.region, pilot=args.pilot)


def main(argv=None):
    parser = argparse.ArgumentParser(prog="run.py", description="Crop-rotation dataset pipeline")
    sub = parser.add_subparsers(dest="step", required=True)
    for name in MODULES:
        p = sub.add_parser(name)
        p.add_argument("--region", choices=("alba", "full"), default="full")
        p.add_argument("--pilot", action="store_true")
        if name == "step2":
            p.add_argument("--extend", action="store_true",
                           help="append points for under-covered NUTS3; existing rows untouched")
        p.set_defaults(func=_run)
    args = parser.parse_args(argv)
    args.func(args)


if __name__ == "__main__":
    main()
