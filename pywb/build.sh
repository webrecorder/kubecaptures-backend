#!/bin/bash
DIR=$( dirname "${BASH_SOURCE[0]}" )
docker build -t embedsarchive_pywb $DIR
