FROM node:12.8.0

WORKDIR /app

COPY package.json /app/
COPY yarn.lock /app/

RUN yarn install

COPY driver.js /app/
COPY run.sh /app/

CMD /app/run.sh


