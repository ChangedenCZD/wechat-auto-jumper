const cv = require('opencv');
const shell = require('shelljs');
const getPixels = require('get-pixels'); // 获取图片Buffer
const path = require('path');
const tesseract = require('node-tesseract'); // OCR
const lowThresh = 20;
const highThresh = 200;
const nIters = 0;

const RED = [0, 0, 255]; // B, G, R

const colorOffset = 100;

const SCREEN_CAPTURE_FILE_PATH = '/sdcard/wechat_jump.png';
const TARGET_FILE_PATH = '../images/src.png';
const CROP_FILE_PATH = '../images/crop.png';
const LEFT_PART_FILE_PATH = '../images/leftPart.png';
const RIGHT_PART_FILE_PATH = '../images/rightPart.png';
const TEMP_FILE_PATH = '../images/temp.png';

const DEBUG = false;

let timerId = null;
let lastTargetLength = 0;

function run () {
    if (DEBUG) {
        jump();
    } else {
        let screenCaptureCommend = `adb shell screencap -p ${SCREEN_CAPTURE_FILE_PATH}`;
        let copyScreenCaptureCommend = `adb pull ${SCREEN_CAPTURE_FILE_PATH} ${TARGET_FILE_PATH}`;
        shell.exec(screenCaptureCommend);
        shell.exec(copyScreenCaptureCommend);
        tesseract.process(path.resolve(__dirname, TARGET_FILE_PATH), {
                l: 'chi_sim'
            }, function (err, text) {
                if (err) {
                    console.error(err);
                } else {
                    if (text.indexOf('最高分') > 0 || text.indexOf('排行榜') > 0) {//重开
                        console.log('重开');
                        swipe(554, 1584, 554, 1584, 317);
                        startTimer();
                    } else {
                        jump();
                    }
                }
            }
        );
    }
}

console.log('Is Debug?', DEBUG);
run();

function startTimer () {
    if (!DEBUG) {
        stopTimer();
        let delay = 1444 + parseInt(((Math.random() * 100000) % 7000));
        timerId = setTimeout(() => {
            run();
        }, delay);
        console.log(`${delay} ms 后继续`);
    }
}

function stopTimer () {
    if (timerId) {
        clearTimeout(timerId);
    }
    timerId = null;
}

function jump () {
    cv.readImage(TARGET_FILE_PATH, function (err, im) {
        if (err) throw err;
        let width = im.width();
        let height = im.height();
        if (width < 1 || height < 1) throw new Error('Image has no size');

        let targetWidth = width;
        let targetHeight = height * 0.5;
        let im_canny = im.copy().crop(0, height * 0.25, targetWidth, targetHeight);
        im_canny.canny(lowThresh, highThresh);
        im_canny.dilate(nIters);
        let contours = im_canny.findContours();
        let outputFile = new cv.Matrix(targetHeight, targetWidth);
        outputFile.drawAllContours(contours, RED, -1);
        outputFile.save(CROP_FILE_PATH);
        let halfWidth = targetWidth * 0.5;
        let leftPart = outputFile.crop(0, 0, halfWidth, targetHeight);
        let rightPart = outputFile.crop(halfWidth, 0, halfWidth, targetHeight);
        leftPart.save(LEFT_PART_FILE_PATH);
        rightPart.save(RIGHT_PART_FILE_PATH);
        try {
            findIndex(LEFT_PART_FILE_PATH).then(left => {
                findPixelByX(LEFT_PART_FILE_PATH, left[0]).then(left => {
                    findIndex(RIGHT_PART_FILE_PATH).then(right => {
                        findPixelByX(RIGHT_PART_FILE_PATH, right[0]).then(right => {
                            simulateSwipe(computeDistance(left, right, halfWidth), width, height);
                        });
                    });
                });
            });
        } catch (e) {
            console.error(e);
            startTimer();
        }
    });
}

function findIndex (filePath) {
    return new Promise(resolve => {
        checkAndFixImage(filePath, 0).then(result => {
            resolve(result);
        });
    });
}

function checkAndFixImage (filePath, fixCount, cb) {
    return new Promise(resolve => {
        cb = cb || resolve;
        findTopPixel(filePath).then(result => {
            let pixel = result.pixel;
            if (isValidTop(pixel, result.image)) {
                pixel[0] += fixCount;
                cb(pixel);
            } else {
                fixImage(filePath).then(() => {
                    fixCount++;
                    checkAndFixImage(TEMP_FILE_PATH, fixCount, cb);
                });
            }
        });
    });
}

function fixImage (filePath) {
    return new Promise(resolve => {
        cv.readImage(filePath, function (err, im) {
            if (err) throw err;
            let width = im.width();
            let height = im.height();
            if (width < 1 || height < 1) throw new Error('Image has no size');
            let im_canny = im.copy().crop(1, 0, width - 2, height);
            im_canny.save(TEMP_FILE_PATH);
            resolve();
        });
    });
}

function isValidTop (pixel, image) {
    let data = image.data;
    let targetWidth = image.shape[0];
    let x = pixel[0];
    return x > 0 && !((pixel[0] + 5) > targetWidth && isValidColor(data[((pixel[1] + 1) * targetWidth - 1) * 4]));
}

function findTopPixel (file) {
    return new Promise(resolve => {
        getPixels(file, function (err, image) {
            if (err) {
                console.error(err);
            } else {
                let data = image.data;
                let targetWidth = image.shape[0];
                let targetHeight = image.shape[1];
                let length = targetWidth * targetHeight;
                let pixel = [0, 0];
                let t = 0;
                for (t; t < length; t++) {
                    let g = data[t * 4];
                    if (isValidColor(g)) {
                        let x = t % targetWidth;
                        pixel = [x, parseInt(t / targetWidth)];
                        break;
                    }
                }
                resolve({
                    pixel, image
                });
            }
        });
    });
}

function findPixelByX (file, x) {
    return new Promise(resolve => {
        getPixels(file, function (err, pixels) {
            if (err) {
                console.error(err);
            } else {
                let data = pixels.data;
                let targetWidth = pixels.shape[0];
                let targetHeight = pixels.shape[1];
                let length = targetWidth * targetHeight;
                let pixelList = [];
                let t = 0;
                for (t; t < length; t += targetWidth) {
                    let g = data[(t + x) * 4];
                    if (isValidColor(g)) {
                        pixelList.push([(t + x) % targetWidth, parseInt(t / targetWidth)]);
                    }
                }
                resolve(pixelList);
            }
        });
    });
}

function isValidColor (color) {
    return color > colorOffset;
}

function computeDistance (left, right, offset) {
    let data = computePieceAndTarget(left, right, offset);
    let pieceIndex = data[0];
    let targetIndex = data[1];
    console.log('PieceIndex =', pieceIndex, 'TargetIndex=', targetIndex, 'Piece on left of center?', isPieceOnLeft(left, right));
    return Math.sqrt(Math.pow(Math.abs(pieceIndex[0] - targetIndex[0]), 2) + Math.pow(Math.abs(pieceIndex[1] - targetIndex[1]), 2));
}

function isPieceOnLeft (left, right) {
    let leftLikePiece = false;
    if (left.length >= 4) {
        let bodyHeaderRation = checkBodyHeaderRatio(left);
        leftLikePiece = bodyHeaderRation > 2 && bodyHeaderRation < 3;
    }
    let rightLikePiece = false;
    if (right.length >= 4) {
        let bodyHeaderRation = checkBodyHeaderRatio(right);
        rightLikePiece = bodyHeaderRation > 2 && bodyHeaderRation < 3;
    }
    return leftLikePiece || !rightLikePiece;
}

function checkBodyHeaderRatio (pixels) {
    try {
        return (pixels[3][1] - pixels[2][1]) / (pixels[1][1] - pixels[0][1]);
    } catch (e) {
        return 0;
    }
}

function computePieceAndTarget (left, right, offset) {
    let pieceIndex = [0, 0];
    let targetIndex = [0, 0];
    try {
        if (isPieceOnLeft(left, right)) { // 左边的是棋子
            pieceIndex = computePieceIndex(left);
            targetIndex = computeTargetIndex(right);
            targetIndex[0] += offset;
        } else {
            pieceIndex = computePieceIndex(right);
            targetIndex = computeTargetIndex(left);
            pieceIndex[0] += offset;
        }
    } catch (e) {//盲区
        console.error(e);
        throw e;
    }
    pieceIndex[0] += 3;
    return [pieceIndex, targetIndex];
}

function computePieceIndex (pixels) {
    let topPixel = pixels[0];
    let topPixelY = topPixel[1];
    let height = pixels[3][1] - topPixelY;
    let bottomY = height * 190 / 210;
    let y = bottomY + topPixelY;
    return [topPixel[0], y];
}

function computeTargetIndex (pixels) {
    let topPixel = pixels[0];
    let bottomPixel = pixels[1];
    let a = bottomPixel[1] - topPixel[1];
    if (a < 11) {
        topPixel = pixels[1];
        bottomPixel = pixels[2];
    } else if (a < 200 && pixels.length > 4) {
        let a = bottomPixel[1] - topPixel[1];
        let b = pixels[3][1] - pixels[2][1];
        if (b >= a && (pixels[2][1] - pixels[1][1]) < a && (a + 40) >= b) {
            bottomPixel = pixels[3];
        }
    }
    console.log('Target first distance =', a);
    lastTargetLength = pixels.length;
    return [topPixel[0], (bottomPixel[1] + topPixel[1]) / 2];
}

function simulateSwipe (distance, maxX, maxY) {
    let touchStartX = maxX / 2;
    let touchStartY = maxY / 2;
    touchStartX += genRandomNumber() % touchStartX;
    touchStartY += genRandomNumber() % touchStartY;
    let touchEndX = Math.min(genRandomNumber() % colorOffset + touchStartX, maxX);
    let touchEndY = Math.min(genRandomNumber() % colorOffset + touchStartY, maxY);
    let ratio = Math.sqrt(2 + (lastTargetLength > 4 ? -0.1 : 0));
    let delay = Math.max(parseInt(distance * ratio), 200);
    console.log('distance =', distance, 'delay =', delay, 'ratio =', ratio);
    swipe(touchStartX, touchStartY, touchEndX, touchEndY, delay);
    startTimer();
}

function genRandomNumber () {
    return parseInt(Math.pow(Math.random() * 10, Math.random() * 10));
}

function swipe (touchStartX, touchStartY, touchEndX, touchEndY, delay) {
    let commend = `adb shell input swipe ${touchStartX} ${touchStartY} ${touchEndX} ${touchEndY} ${delay}`;
    console.log(commend);
    if (!DEBUG) {
        shell.exec(commend);
    }
}