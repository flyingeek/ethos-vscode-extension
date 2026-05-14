We want to make a parser for the Ethos log Files format, we want to also support partially EdgeTx log format. You have examples of both formats in the csv-examples folder. The parser should be able to read the csv file and extract the telemetry data, then inject it into the Ethos simulator using the `ethos.injectTelemetry` command. The API is described in the ./inject-telemetry-api.md file.

The parser must accept big csv files, so it should read the file line by line and inject the telemetry data in real time or with a speed multiplier.

The parser should also be able to handle missing or extra columns in the csv file.

We want to get the list of available frame names from the Ethos simulator using the `ethos.getSensors` command, and only inject the frames that are defined in the sensors.json file. Note that CSV row1 contains name that might not match perfectly the frame names in sensors.json, so we need to do some mapping or normalization to ensure that we are injecting the correct frames.

The parser should injectTelemetry at the same rate as the csv file, or with a speed multiplier if specified. For example, if the csv file has a timestamp column, we can use it to calculate the delay between each line and inject the telemetry data accordingly. If the speed multiplier is 2x, we can inject the data twice as fast as the original timestamps.
