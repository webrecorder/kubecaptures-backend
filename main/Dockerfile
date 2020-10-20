FROM webrecorder/browserkube

WORKDIR /app/

ADD capture.py /app/

ENV APP_MODULE capture

CMD ./run.sh

COPY templates/ /app/templates/
