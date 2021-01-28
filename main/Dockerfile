ARG FRONTEND_IMAGE
ARG BASE_IMAGE

FROM $FRONTEND_IMAGE AS frontend
FROM $BASE_IMAGE

COPY --from=frontend /app/dist/app.js /app/static/app.js

ENV APP_MODULE capture

COPY templates/ /app/templates/
COPY replay/ /app/replay/

ADD capture.py /app/
