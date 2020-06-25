import { createLogger, format, transports } from "winston";

const logger = createLogger({
	level: "info",
	format: format.json({
		space: 4
	}),
	defaultMeta: { service: "user-service" },
	transports: [
		new transports.File({ filename: "logs/error.log", level: "error" }),
		new transports.Console({ level: "error", format: format.errors() }),
		new transports.Console({ level: "info", format: format.simple() }),
		new transports.File({ filename: "logs/verbose.log" })
	]
});

export default logger;