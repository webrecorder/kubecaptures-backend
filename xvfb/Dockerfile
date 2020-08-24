FROM python:3.8-alpine

RUN set -xe; \
    apk add --update xvfb;\
    rm -rf /var/cache/apk/*;

ENV DISPLAY ":99"
ENV GEOMETRY "1360x1020x16"

WORKDIR /app/
ADD run.sh /app/run.sh
ADD run.py /app/

CMD ["/app/run.sh"]

