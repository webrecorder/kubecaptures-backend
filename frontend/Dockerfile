ARG BASE_IMAGE
FROM $BASE_IMAGE

WORKDIR /app

COPY package.json /app/
COPY yarn.lock /app/
RUN yarn install

COPY . /app/
RUN yarn run build
