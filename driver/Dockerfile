ARG BASE_IMAGE
FROM $BASE_IMAGE

WORKDIR /app

COPY run.sh /app/
CMD /app/run.sh

COPY package.json /app/
COPY yarn.lock /app/
RUN yarn install

COPY embeds.json /app/
COPY *.js /app/
