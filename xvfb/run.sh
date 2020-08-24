#!/bin/sh

echo "Starting XVFB..."

Xvfb $DISPLAY -listen tcp -screen 0 $GEOMETRY -ac +extension RANDR &

python run.py

echo "Done!"
