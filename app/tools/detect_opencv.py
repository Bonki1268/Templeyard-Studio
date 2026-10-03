#!/usr/bin/env python3
"""本機人臉與車牌偵測（OpenCV Haar 分類器，免費、不連網）。
用法：python3 detect_opencv.py <圖片>；輸出 JSON 陣列，座標為 0～1 的比例。"""
import json
import sys

import cv2


def detect(path):
    img = cv2.imread(path)
    if img is None:
        raise SystemExit(f"無法讀取圖片：{path}")
    h, w = img.shape[:2]
    gray = cv2.equalizeHist(cv2.cvtColor(img, cv2.COLOR_BGR2GRAY))
    found = []
    for kind, name in (("face", "haarcascade_frontalface_default.xml"), ("plate", "haarcascade_russian_plate_number.xml")):
        cascade = cv2.CascadeClassifier(cv2.data.haarcascades + name)
        boxes = cascade.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=6, minSize=(24, 24))
        for (x, y, bw, bh) in boxes:
            pad = 0.15
            x0, y0 = max(0, x - bw * pad), max(0, y - bh * pad)
            x1, y1 = min(w, x + bw * (1 + pad)), min(h, y + bh * (1 + pad))
            found.append({"kind": kind, "x": x0 / w, "y": y0 / h, "w": (x1 - x0) / w, "h": (y1 - y0) / h})
    return found


if __name__ == "__main__":
    print(json.dumps(detect(sys.argv[1])))
