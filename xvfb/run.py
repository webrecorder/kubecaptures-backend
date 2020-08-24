import time
import os

exit_file = os.environ.get("EXIT_FILE")

while True:
    if exit_file and os.path.isfile(exit_file):
        break

    time.sleep(5)
