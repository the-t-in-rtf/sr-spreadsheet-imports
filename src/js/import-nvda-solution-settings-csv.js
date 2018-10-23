"use strict";
var fluid = require("infusion");

var fs = require("fs");
var JSON5 = require("json5");

var existingSolutionsPath = "/Users/duhrer/Source/rtf/universal/testData/solutions/win32.json5";
var existingSolutionData = JSON5.parse(fs.readFileSync(existingSolutionsPath));
var existingSolutionKeys = Object.keys(fluid.get(existingSolutionData,["org.nvda-project",  "settingsHandlers", "configs", "supportedSettings"]));

fs.writeFileSync("/tmp/existing-solution-keys.txt", JSON.stringify(existingSolutionKeys, null, 2));

var csvPath = "/Users/duhrer/Downloads/NVDA Product & Metadata File - Metadata.csv";
var csv = require("fast-csv");
var stream = fs.createReadStream(csvPath);

function parseArray(arrayAsString) {
    var parsedArray = [];
    try {
        parsedArray = arrayAsString.split(/ *, */).map(parseField);
        return parsedArray;
    }
    catch (e) {
        console.log("Can't parse array, leaving the value alone.");
        return arrayAsString;
    }
}

function parseField(rawValue) {
    try {
        var parsedValue = JSON.parse(rawValue);
        return parsedValue;
    }
    catch (e) {
        return rawValue;
    }
}
// Raw mappings for documentation purposes
//var arrayToObject = {
//    "onboard":                "0",  // A
//    "installation dependent": "1",  // B
//    "type of setting":        "2",  // C
//    "exposed":                "3",  // D
//    "notes":                  "4",  // E
//    "path / group":           "5",  // F
//    "manufacturer name":      "6",  // G
//    "morphic group":          "7",  // H
//    "morphic name":           "8",  // I
//    "description":            "9",  // J
//    "manufacturer keywords":  "10", // K
//    "pointer":                "11", // L
//    "machine group":          "12", // M
//    "machine name":           "13", // N
//    "data type":              "14", // O
//    "machine value space":    "15", // P
//    "user value space":       "16", // Q
//    "default":                "17"  // R
//    // There are more, but our train stops here.
//};

var arrayToObject = {
    "onboard": "0", // A
    "title": {
        transform: {
            type: "fluid.transforms.firstValue",
            values: ["8", "6", "13"] // Prefer "our" name if available, then the manufacturer, then failover to the machine name.
        }
    },
    "description":         "9", // J
    // CONCAT 12 and 13 with a dot between.
    "id": {
        transform: {
            type: "fluid.transforms.binaryOp",
            leftPath: "12",
            right: {
                transform: {
                    type: "fluid.transforms.binaryOp",
                    left: ".",
                    rightPath: "13",
                    operator: "+"
                }
            },
            operator: "+"
        }
    },
    "type":                "14", // O
    "machine value space": "15", // P
    "user value space":    "16", // Q
    "default":             "17"  // R
};

var missingData = function (candidate) {
    var errors = [];
    var baseFields = ["title", "description", "id", "type"];
    var enumFields = baseFields.concat(["machine value space", "user value space"]);
    var fieldsToCheck = candidate.type === "Choose 1 from List" ? enumFields : baseFields;
    fluid.each(fieldsToCheck, function (key) {
        if (fluid.get(candidate, key) === undefined) {
            errors.push(key);
        }
    });

    if (errors.length) {
        console.log("Record '" + candidate.title + "' is missing the following fields: " + errors.join(", "));
    }

    return errors.length > 0;
};

var rowNumber = 0;
var jsonData = {};
var csvStream = csv({ delimiter: ","})
    .on("data", function (data) {
        if (rowNumber > 0) {
            var dataMinusEmptyStrings = data.map(function (entry) { return entry.trim() === "" ? undefined : entry.trim(); });
            var rowData = fluid.model.transformWithRules(dataMinusEmptyStrings, arrayToObject);
            if (rowData.onboard && rowData.onboard.indexOf("Done") !== -1) {
                console.log("Skipping completed record '" + rowData.title + "'.");
            }
            else if (["Revised - for LSR", "Yes"].indexOf(rowData.onboard) === -1) {
                console.log("Skipping record '" + rowData.title + "' because its status is wrong.");
            }
            else if (missingData(rowData)) {
                return;
            }
            else if (existingSolutionKeys.indexOf(rowData["machine name"]) !== -1 && fluid.get(existingSolutionKeys, [rowData["machine name"], "schema"]) !== undefined) {
                console.log("Skipping record '" + rowData.title + "' that has schema data.");
            }
            else {
                var key = rowData.id;
                var candidateSolutionSetting = fluid.filterKeys(rowData, ["title", "description"]);

                // Break apart titles that were derived from the machine name.
                var periodIndex = rowData.title.indexOf(".");
                if (periodIndex !== -1)  {
                    var segments = rowData.title.split(".");
                    var textToExpand = segments.splice(1).join("");
                    var titleCaseMatches = textToExpand.match(/([A-Z]+[a-z0-9]+)/g);
                    if (titleCaseMatches) {
                        candidateSolutionSetting.title = titleCaseMatches.join(" ");
                    }
                }

                if (rowData.type === "Binary") {
                    candidateSolutionSetting["enum"] = [0,1];
                    candidateSolutionSetting.enumLabels = ["off", "on"];
                    if (rowData["default"]) {
                        candidateSolutionSetting["default"] = parseField(rowData["default"]);
                    }
                }
                else if (rowData.type === "Choose 1 from List") {
                    candidateSolutionSetting["enum"] = parseArray(rowData["machine value space"]); // We know this will be broken and cleaned up manually.
                    candidateSolutionSetting.enumLabels = parseArray(rowData["user value space"]);
                    if (rowData["default"]) {
                        candidateSolutionSetting["default"] = parseField(rowData["default"]);
                    }
                }
                else if (rowData.type === "User entered String") {
                    candidateSolutionSetting.type = "string";
                    if (rowData["default"]) {
                        candidateSolutionSetting["default"] = parseField(rowData["default"]);
                    }
                }
                else if (rowData.type === "Integer") {
                    candidateSolutionSetting.type = "integer";
                    if (rowData["default"]) {
                        candidateSolutionSetting["default"] = parseInt(rowData["default"], 10);
                    }
                }
                else {
                    console.log("bad type '" + rowData.type + "'.");
                    return;
                }

                fluid.set(jsonData, [key, "schema"], candidateSolutionSetting);
            }
            /*

                Ignore anything where column 0 is "Done" or "No".

                Must have a non-empty value for:
                     column 12 ("key")
                     column 6 ("title"),
                     column 8 ("description"),
                     column 13 ("data type"), will need to make a map for it.

                Can make use of a value for:
                     column 14 ("value range ish") depending
                     if column 16 ("default") is set, set that.

             */
        }
        rowNumber++;
    })
    .on("end", function () {
        console.log("Processed", rowNumber, "rows of data and found", Object.keys(jsonData).length, "usable solutions.");

        var outputPath = "/tmp/nvda-candidate-solutions.json";
        fs.writeFileSync(outputPath, JSON.stringify(jsonData, null, 2));
        console.log("Saved raw output to '" + outputPath + "'.");
    });

stream.pipe(csvStream);
