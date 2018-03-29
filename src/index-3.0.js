const shell = require('shelljs');
const glob = require('glob');
const cv = require('opencv4nodejs');

const SCREEN_CAPTURE_FILE_PATH = '/sdcard/wechat_jump.jpg';
const TARGET_FILE_PATH = '../images/src.jpg';
const BOX_FILE_PATH = '../images/box.jpg';
const START_BUTTON_TEMPLATE_FILE_PATH = '../images/start_button_template.jpg';
const CLOSE_BUTTON_TEMPLATE_FILE_PATH = '../images/close_button_template.jpg';
const PIECE_TEMPLATE_FILE_PATH = '../images/piece_template.jpg';

const DEBUG = false;
const SCREEN_CAP = DEBUG ? false : true;

let startTime;
const pieceIndex = {x: 0, y: 0, position: 0};
const boxIndex = {x: 0, y: 0, position: 1};

let maxRow = 0;
let maxCol = 0;
let halfWidth = 0;
let halfHeight = 0;

let box = null;
let lastBox = null;
let distance = null;

let currentRound = 0;
let maxRound = 0;

function screenCap () {
    if (SCREEN_CAP) {
        let screenCaptureCommend = `adb shell screencap -p ${SCREEN_CAPTURE_FILE_PATH}`;
        let copyScreenCaptureCommend = `adb pull ${SCREEN_CAPTURE_FILE_PATH} ${TARGET_FILE_PATH}`;
        shell.exec(screenCaptureCommend);
        shell.exec(copyScreenCaptureCommend);
    }
}

function parseImage () {
    let image = cv.imread(TARGET_FILE_PATH);
    maxRow = image.rows;
    maxCol = image.cols;
    halfWidth = parseInt(maxCol * 0.5);
    halfHeight = parseInt(maxRow * 0.5);
    let mat = image.copy(new cv.Mat(maxRow, maxCol));
    box = mat.copy().gaussianBlur(new cv.Size(3, 3), 1).bgrToGray().canny(30, 200);
}

function findPiece () {
    let template = cv.imread(PIECE_TEMPLATE_FILE_PATH);
    template = template.bgrToGray();
    let match = box.matchTemplate(template, cv.TM_CCOEFF_NORMED);
    let loc = match.minMaxLoc();
    let maxLoc = loc.maxLoc;
    let x = pieceIndex.x = parseInt(maxLoc.x + template.cols * 0.5);
    let y = pieceIndex.y = parseInt(maxLoc.y + template.rows * 190 / 210);
    // let yOffset = 0.7;
    // let xOffset = 0.9;
    // let maxScanRow = parseInt(maxRow * yOffset);
    // let maxScanCol = parseInt(maxCol * xOffset);
    // let pieceScanStartX = parseInt(maxCol * (1 - xOffset));
    // let array = piece.getDataAsArray();
    // let headerIndex = null;
    // outer:
    //     for (let r = parseInt(maxRow * (1 - yOffset)); r < maxScanRow; r++) {
    //         let row = array[r];
    //         for (let c = pieceScanStartX; c < maxScanCol; c++) {
    //             let pixel = row[c];
    //             if (pixel < 255) {
    //                 if (!headerIndex) {
    //                     headerIndex = {x: c, y: r};
    //                     break outer;
    //                 }
    //             }
    //         }
    //     }
    // let x = pieceIndex.x = headerIndex.x + 5;
    // let y = pieceIndex.y = headerIndex.y + 190;
    if (x < 1 || y < 1) {
        console.log('Piece index error.');
        pieceIndex.position = -1;
    } else {
        pieceIndex.position = halfWidth > x ? 0 : 1;
    }
}

function findBox () {
    let piecePosition = pieceIndex.position;
    boxIndex.position = piecePosition > 0 ? 0 : 1;
    let targetIndex = null;
    glob.sync('../images/box_template/**/*.*').forEach(filePath => {
        targetIndex = compareIndex(targetIndex, findBoxByTemplate(filePath));
    });
    if (targetIndex && targetIndex.max < 0.5) {
        console.log('Compute Box Index For Pixel. TemplateIndex =', targetIndex);
        if (piecePosition >= 0) {
            let yOffset = 0.8;
            let xOffset = 0.9;
            let maxScanRow = parseInt(maxRow * yOffset);
            let boxScanStartX = 0;
            let maxScanCol = maxCol;
            let edge = 5;
            if (piecePosition === 0) { //棋子在左边
                boxScanStartX = parseInt(maxCol * (1 - xOffset));
                maxScanCol -= edge;
            } else {
                boxScanStartX += edge;
                maxScanCol = parseInt(maxCol * xOffset);
            }
            let array = box.getDataAsArray();
            let headerIndex = null;
            outer:
                for (let r = parseInt(maxRow * (1 - yOffset)); r < maxScanRow; r++) {
                    let row = array[r];
                    for (let c = boxScanStartX; c < maxScanCol; c++) {
                        let pixel = row[c];
                        if (pixel > 0) {
                            if (!headerIndex) {
                                headerIndex = {x: c, y: r};
                                break outer;
                            }
                        }
                    }
                }
            let nextY = tryToFindNextY(array, headerIndex);
            let x = headerIndex.x;
            let y = parseInt((headerIndex.y + nextY) * 0.5);
            targetIndex = {x, y};
        }
    }
    boxIndex.x = targetIndex.x;
    boxIndex.y = targetIndex.y + parseInt(maxRow * 0.25);
}

function findNextY (data, relativeIndex) {
    let nextY = relativeIndex.y;
    let x = relativeIndex.x;
    for (let r = nextY + 1; r < maxRow; r++) {
        if (data[r][x] > 0) {
            nextY = r;
            break;
        }
    }
    return nextY;
}

function tryToFindNextY (data, relativeIndex) {
    let y = relativeIndex.y;
    let x = relativeIndex.x;
    relativeIndex = {x, y};
    let nextYForRight;
    let nextYForLeft;
    let xOffset = 5;
    let maxX = Math.min(x + xOffset, maxRow);
    for (let c = x; c <= maxX; c++) {
        relativeIndex.x = c;
        nextYForRight = findNextY(data, relativeIndex);
        if (nextYForRight !== y) {
            break;
        }
    }
    let minX = Math.max(0, x - xOffset);
    for (let c = x; c >= minX; c--) {
        relativeIndex.x = c;
        nextYForLeft = findNextY(data, relativeIndex);
        if (nextYForLeft !== y) {
            break;
        }
    }
    let leftDifference = nextYForLeft - y;
    let value = nextYForLeft;
    if (leftDifference > 200 || leftDifference < 50) {
        value = nextYForRight;
    }
    return Math.max(y + 50, Math.min(value, y + 200));
}

function findBoxByTemplate (tempFilePath) {
    let template = cv.imread(tempFilePath);
    template = template.bgrToGray();
    let match = box.copy().matchTemplate(template, cv.TM_CCOEFF_NORMED);
    let loc = match.minMaxLoc();
    if (DEBUG) {
        console.log(tempFilePath, loc);
    }
    let maxLoc = loc.maxLoc;
    let x = parseInt(maxLoc.x + template.cols * 0.5);
    let y = parseInt(maxLoc.y + template.rows * 0.5);
    let max = loc.maxVal;
    return {x, y, max};
}

function compareIndex (lIndex, rIndex) {
    if (lIndex && rIndex) {
        return lIndex.max > rIndex.max ? lIndex : rIndex;
    } else if (lIndex) {
        return lIndex;
    }
    return rIndex;
}

function computeDistance () {
    distance = Math.sqrt(Math.pow(Math.abs(pieceIndex.x - boxIndex.x), 2) + Math.pow(Math.abs(pieceIndex.y - boxIndex.y), 2));
    // distance = Math.max(Math.min(distance, maxCol * 0.618), 200 / Math.sqrt(2));
}

function simulateSwipe () {
    if (distance) {
        currentRound++;
        let ratio = Math.sqrt(2);
        let delay = parseInt(Math.max(distance * ratio, 200));
        console.log('Piece index =', pieceIndex, 'Box index =', boxIndex, 'Distance =', distance, 'Delay =', delay);
        let touchStartX = parseInt(halfWidth * 0.5) + genRandomNumber() % halfWidth;
        let touchStartY = halfHeight + genRandomNumber() % halfHeight;
        let touchEndX = touchStartX + genRandomNumber() % 5;
        let touchEndY = touchStartY + genRandomNumber() % 5;
        swipe(touchStartX, touchStartY, touchEndX, touchEndY, delay);
        console.log(`尝试第 ${currentRound} 次跳跃`, `历史最高 ${maxRound} 次`);
        lastBox = box;
        tryToRestart(delay + 2000);
    }
}

function genRandomNumber () {
    return parseInt(Math.pow(Math.random() * 10, Math.random() * 10));
}

function swipe (touchStartX, touchStartY, touchEndX, touchEndY, delay) {
    let commend = `adb shell input swipe ${touchStartX} ${touchStartY} ${touchEndX || touchStartX} ${touchEndY || touchEndY} ${delay}`;
    console.log(commend);
    if (!DEBUG) {
        shell.exec(commend);
    }
}

function run () {
    startTime = Date.now();
    screenCap();
    parseImage();
    let template = cv.imread(CLOSE_BUTTON_TEMPLATE_FILE_PATH).bgrToGray();
    let match = box.matchTemplate(template, cv.TM_CCOEFF_NORMED);
    let closeButtonLoc = match.minMaxLoc();
    template = cv.imread(START_BUTTON_TEMPLATE_FILE_PATH).bgrToGray();
    match = box.matchTemplate(template, cv.TM_CCOEFF_NORMED);
    let startButtonLoc = match.minMaxLoc();
    if (startButtonLoc.maxVal > 0.5 && startButtonLoc.maxVal > closeButtonLoc.maxVal) {
        if (lastBox) {
            cv.imwrite(`../images/fail_box/${Date.now()}.jpg`, lastBox);
            console.log('记录失败模板');
        }
        lastBox = null;
        console.log('开始游戏');
        maxRound = Math.max(maxRound, currentRound);
        currentRound = 0;
        let maxLoc = startButtonLoc.maxLoc;
        let touchStartX = maxLoc.x + 50;
        let touchStartY = maxLoc.y + 10;
        let touchEndX = touchStartX + genRandomNumber() % 5;
        let touchEndY = touchStartY + genRandomNumber() % 5;
        swipe(touchStartX, touchStartY, touchEndX, touchEndY, 100);
        tryToRestart(800);
    } else if (closeButtonLoc.maxVal > 0.5) {
        console.log('关闭榜单');
        lastBox = null;
        let touchStartX = 979;
        let touchStartY = 297;
        let touchEndX = touchStartX + genRandomNumber() % 5;
        let touchEndY = touchStartY + genRandomNumber() % 5;
        swipe(touchStartX, touchStartY, touchEndX, touchEndY, 100);
        tryToRestart(800);
    } else {
        let rect = new cv.Rect(0, parseInt(maxRow * 0.25), maxCol, parseInt(maxRow * 0.5));
        box = box.getRegion(rect);
        if (DEBUG) {
            cv.imwrite(BOX_FILE_PATH, box);
        }
        findPiece();
        findBox();
        computeDistance();
        simulateSwipe();
    }
    console.log(`consume:${Date.now() - startTime}ms.`);
}

function tryToRestart (delay) {
    if (!DEBUG) {
        setTimeout(() => {
            run();
        }, delay);
    }
}

run();