# 📚 EbookCC: The Ultimate AI-Powered Comic OCR & Editor

⚡ **Detect, translate, and convert comic speech bubbles with cutting-edge AI OCR and selectable text overlays.** Transform raw manga scans, graphic novels, or personal photos into highly structured, mobile-friendly eBooks with one click.

🚀 **Try it live now:** [https://ebookcc.com/](https://ebookcc.com/)

---

## ✨ Features

### 🎯 Custom YOLO26 Comic Detection
Utilizes an advanced, self-trained **YOLO26 neural network architecture** to detect manga panels and speech bubbles with pixel-perfect accuracy. No more manual cropping.

### 🤖 Hybrid AI-Powered OCR (Cloud & Local)
* **Cloud Power:** Seamless integration with Google **Cloud Gemini API** for state-of-the-art layout analysis and text extraction.
* **100% Offline & Private:** Hook into your own self-hosted **Local LLMs** (`Ollama`, `LM Studio`, or `Llama.cpp`) to process sensitive content with zero data leakage.

### 📱 Smart Panel Splitting (Guided View)
Intelligently slices complex comic layouts into individual pages or guided-view blocks. Perfectly optimizes raw manga for comfortable reading on small screens like smartphones and Kindle/Kobo e-readers.

### 🪄 One-Click eBook Generation
Instantly convert your image directories, ZIP, or CBZ files into standard **reflowable or fixed-layout eBooks** with automated Table-of-Contents (ToC) generation.

---

## 🛠️ How It Works (Quick Overview)

1. **Upload:** Drop your comic pages, ZIP, or CBZ files into EbookCC.
2. **AI Detect & OCR:** The **YOLO26** model finds the panels and text bubbles, and **Gemini/Local LLM** extracts the text.
3. **Edit/Translate:** Use the **Rich Editor** to translate, typeset, or adjust bubbles.
4. **Export:** Export as a beautifully formatted eBook or images with text overlays.
## Local Development

To run this application locally on your machine, check out these quick steps:

1. **Install Dependencies**:
   ```bash
   npm install
   ```

2. **Run in Development Mode**:
   ```bash
   npm run dev
   ```

3. **Compile a Production Build**:
   ```bash
   npm run build
   ```

4. **Launch the Production Build**:
   ```bash
   npm run start
   ```

---

## ☕ Support the Project

If **EbookCC** has saved you time and made your comic-reading or editing process smoother, please consider supporting the creator:

[![Buy me a coffee](https://img.shields.io/badge/Buy_me_a_coffee-FF5E5B?style=for-the-badge&logo=ko-fi&logoColor=white)](https://ko-fi.com/kollolliver)

Your support helps keep development active and funds high-precision OCR and translation features. Thank you!

---
