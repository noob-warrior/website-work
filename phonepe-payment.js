/**
 * Shared UPI payment helpers for services, courses, and product checkout.
 * Opens a UPI intent directly with the amount prefilled for the configured ID.
 */
(function () {
    const BUSINESS_NAME = 'Divinity Swati Sobti';
    const UPI_ID = '9311319923@axl';
    const DEFAULT_NUMBER = '919625746605';
    const PAYMENT_QR_SIZE = 280;
    const QR_CODE_LIBRARY_URL = 'qrcode.min.js';
    let activeQrPayment = null;
    let qrCodeLibraryPromise = null;

    function normalizeNumber(value) {
        const digits = String(value || '').replace(/\D/g, '');
        return digits || DEFAULT_NUMBER;
    }

    function getDefaultNumber() {
        const metaNumber = document.querySelector('meta[name="whatsapp-to"]')?.content;
        return normalizeNumber(window.WHATSAPP_FALLBACK_NUMBER || metaNumber || DEFAULT_NUMBER);
    }

    function getUpiId() {
        const metaUpi = document.querySelector('meta[name="upi-id"]')?.content;
        return String(window.UPI_PAYMENT_ID || metaUpi || UPI_ID).trim();
    }

    function openWhatsApp(message) {
        if (window.AstrologyWhatsApp && typeof window.AstrologyWhatsApp.openWhatsApp === 'function') {
            return window.AstrologyWhatsApp.openWhatsApp(message);
        }

        const url = `https://wa.me/${getDefaultNumber()}?text=${encodeURIComponent(message)}`;
        const popup = window.open(url, '_blank', 'noopener,noreferrer');
        if (!popup) {
            window.location.href = url;
        }
        return true;
    }

    function parsePriceInPaise(priceValue) {
        if (typeof priceValue === 'number' && Number.isFinite(priceValue)) {
            return Math.max(0, Math.round(priceValue * 100));
        }

        const cleaned = String(priceValue || '')
            .replace(/&#8377;/g, '')
            .replace(/Rs\.?/gi, '')
            .replace(/INR/gi, '')
            .replace(/,/g, '');
        const match = cleaned.match(/\d+(?:\.\d{1,2})?/);
        const rupees = match ? Number(match[0]) : 0;
        return Number.isFinite(rupees) ? Math.max(0, Math.round(rupees * 100)) : 0;
    }

    function formatPaise(amountPaise) {
        const rupees = Math.max(0, Number(amountPaise || 0) / 100);
        const hasDecimals = !Number.isInteger(rupees);
        return `Rs. ${rupees.toLocaleString('en-IN', {
            minimumFractionDigits: hasDecimals ? 2 : 0,
            maximumFractionDigits: 2
        })}`;
    }

    function createMerchantOrderId() {
        return `DS_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`.slice(0, 63);
    }

    function formatAmountForUpi(amountPaise) {
        return (Math.max(0, Number(amountPaise || 0)) / 100).toFixed(2);
    }

    function setStatus(message, state) {
        document.querySelectorAll('[data-phonepe-status]').forEach((target) => {
            target.textContent = message;
            target.dataset.state = state || 'info';
        });
    }

    function getUpiTransactionNote(options) {
        const description = String(options.description || BUSINESS_NAME).replace(/\s+/g, ' ').trim();
        return description.slice(0, 80);
    }

    function getCourseAmountValue(course) {
        return course?.fee || course?.price || course?.amount || '';
    }

    function getCourseTitle(course) {
        return course?.title || course?.name || 'Course Enrollment';
    }

    function buildUpiUrl(options) {
        const merchantOrderId = options.merchantOrderId || createMerchantOrderId();
        const params = new URLSearchParams({
            pa: getUpiId(),
            pn: BUSINESS_NAME,
            tr: merchantOrderId,
            tn: getUpiTransactionNote(options),
            am: formatAmountForUpi(options.amountPaise),
            cu: 'INR'
        });

        return `upi://pay?${params.toString()}`;
    }

    function isLikelyMobileDevice() {
        if (navigator.userAgentData && typeof navigator.userAgentData.mobile === 'boolean') {
            return navigator.userAgentData.mobile;
        }

        const userAgent = navigator.userAgent || '';
        if (/Android|iPhone|iPad|iPod|IEMobile|Opera Mini|Mobile/i.test(userAgent)) {
            return true;
        }

        const hasTouch = navigator.maxTouchPoints && navigator.maxTouchPoints > 1;
        const isNarrow = window.matchMedia && window.matchMedia('(max-width: 760px)').matches;
        return Boolean(hasTouch && isNarrow);
    }

    function closePaymentQrModal() {
        const modal = document.querySelector('[data-upi-qr-modal]');
        if (!modal) return;

        modal.hidden = true;
        modal.classList.remove('is-open');
        document.body.classList.remove('upi-qr-modal-open');
        activeQrPayment = null;
    }

    function ensurePaymentQrModal() {
        let modal = document.querySelector('[data-upi-qr-modal]');
        if (modal) return modal;

        modal = document.createElement('div');
        modal.className = 'upi-qr-modal';
        modal.dataset.upiQrModal = '';
        modal.hidden = true;
        modal.innerHTML = `
            <div class="upi-qr-dialog" role="dialog" aria-modal="true" aria-labelledby="upiQrTitle">
                <button class="upi-qr-close" type="button" data-upi-qr-close aria-label="Close payment QR">
                    <span aria-hidden="true">x</span>
                </button>
                <div class="upi-qr-heading">
                    <div class="phonepe-logo-mark">UPI</div>
                    <div>
                        <h2 id="upiQrTitle">Scan to pay with UPI</h2>
                        <p>Open any UPI app on your phone and scan this code.</p>
                    </div>
                </div>
                <div class="upi-qr-code-wrap">
                    <img data-upi-qr-image alt="UPI payment QR code">
                </div>
                <div class="upi-qr-details" aria-live="polite">
                    <div>
                        <span>Amount</span>
                        <strong data-upi-qr-amount></strong>
                    </div>
                    <div>
                        <span>UPI ID</span>
                        <strong data-upi-qr-upi></strong>
                    </div>
                    <div>
                        <span>Note</span>
                        <strong data-upi-qr-note></strong>
                    </div>
                </div>
                <div class="upi-qr-actions">
                    <a class="upi-qr-link" href="#" data-upi-qr-direct>Open UPI app</a>
                    <button class="upi-qr-done" type="button" data-upi-qr-paid>I've completed payment</button>
                </div>
            </div>
        `;

        modal.addEventListener('click', (event) => {
            if (event.target === modal || event.target.closest('[data-upi-qr-close]')) {
                closePaymentQrModal();
                return;
            }

            if (event.target.closest('[data-upi-qr-paid]')) {
                const onConcluded = activeQrPayment?.onConcluded;
                closePaymentQrModal();
                setStatus('Payment marked complete. Thank you.', 'success');
                if (typeof onConcluded === 'function') {
                    onConcluded();
                }
            }
        });

        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && !modal.hidden) {
                closePaymentQrModal();
            }
        });

        document.body.appendChild(modal);
        return modal;
    }

    function loadQrCodeLibrary() {
        if (typeof window.qrcode === 'function') {
            return Promise.resolve(window.qrcode);
        }

        if (qrCodeLibraryPromise) {
            return qrCodeLibraryPromise;
        }

        qrCodeLibraryPromise = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = QR_CODE_LIBRARY_URL;
            script.async = true;
            script.onload = () => {
                if (typeof window.qrcode === 'function') {
                    resolve(window.qrcode);
                } else {
                    reject(new Error('QR code library did not load.'));
                }
            };
            script.onerror = () => reject(new Error('QR code library could not be loaded.'));
            document.head.appendChild(script);
        });

        return qrCodeLibraryPromise;
    }

    function renderQrCode(image, upiUrl) {
        return loadQrCodeLibrary().then((createQrCode) => {
            const qrCode = createQrCode(0, 'M');
            qrCode.addData(upiUrl);
            qrCode.make();

            const moduleCount = qrCode.getModuleCount();
            const margin = 8;
            const cellSize = Math.max(2, Math.floor((PAYMENT_QR_SIZE - margin * 2) / moduleCount));
            image.src = qrCode.createDataURL(cellSize, margin);
        });
    }

    function showDesktopPaymentQr(options, upiUrl) {
        const modal = ensurePaymentQrModal();
        const amountText = formatPaise(options.amountPaise);
        const upiId = getUpiId();
        const qrImage = modal.querySelector('[data-upi-qr-image]');
        const directLink = modal.querySelector('[data-upi-qr-direct]');

        activeQrPayment = { ...options, upiUrl };
        modal.querySelector('[data-upi-qr-amount]').textContent = amountText;
        modal.querySelector('[data-upi-qr-upi]').textContent = upiId;
        modal.querySelector('[data-upi-qr-note]').textContent = getUpiTransactionNote(options);
        directLink.href = upiUrl;

        modal.hidden = false;
        modal.classList.add('is-open');
        document.body.classList.add('upi-qr-modal-open');
        setStatus(`Preparing QR code for ${amountText} to ${upiId}...`, 'loading');
        renderQrCode(qrImage, upiUrl)
            .then(() => {
                if (activeQrPayment?.upiUrl === upiUrl) {
                    setStatus(`Scan the QR code to pay ${amountText} to ${upiId}.`, 'loading');
                }
            })
            .catch(() => {
                if (activeQrPayment?.upiUrl === upiUrl) {
                    setStatus('Could not load the payment QR. Please try again from a mobile device.', 'error');
                }
            });
        return true;
    }

    function openUpiPayment(options) {
        options = options || {};
        const amountPaise = Number(options.amountPaise || 0);
        if (!amountPaise || amountPaise < 100) {
            alert('Could not read the UPI payment amount. Please try again.');
            return false;
        }

        const paymentOptions = { ...options, amountPaise };
        const upiUrl = buildUpiUrl(paymentOptions);
        if (!isLikelyMobileDevice()) {
            return showDesktopPaymentQr(paymentOptions, upiUrl);
        }

        setStatus(`Opening UPI app for ${formatPaise(amountPaise)} to ${getUpiId()}...`, 'loading');
        window.location.href = upiUrl;
        return true;
    }

    function requestUpiPayment(options) {
        return openUpiPayment(options);
    }

    function requestPhonePePaymentLink(orderText, amountPaise, description) {
        return requestUpiPayment({ orderText, amountPaise, description });
    }

    function openPhonePeCheckout(options) {
        options = options || {};
        const amountPaise = Number(options.amountPaise || 0);
        if (!amountPaise || amountPaise < 100) {
            alert('Could not read the UPI payment amount. Please try again.');
            return false;
        }

        return requestUpiPayment({ ...options, amountPaise });
    }

    function bookSession(serviceLabel, session) {
        const amountPaise = parsePriceInPaise(session.price);
        const orderText = [
            'New Session Booking',
            '',
            `Service: ${serviceLabel}`,
            `Session: ${session.title}`,
            `Duration: ${session.duration}`,
            `Fee: ${formatPaise(amountPaise)} (${session.priceLabel})`
        ].join('\n');

        return openPhonePeCheckout({
            amountPaise,
            description: `${serviceLabel} - ${session.title} (${session.duration})`,
            orderText
        });
    }

    function orderPackage(service, selectedPackage) {
        const amountPaise = parsePriceInPaise(selectedPackage.price);
        const orderText = [
            'New Package Order',
            '',
            `Service: ${service.title}`,
            `Package: ${selectedPackage.title}`,
            `Fee: ${formatPaise(amountPaise)} (${selectedPackage.priceLabel})`
        ].join('\n');

        return openPhonePeCheckout({
            amountPaise,
            description: `${service.title} - ${selectedPackage.title}`,
            orderText
        });
    }

    function joinCourse(course) {
        course = course || {};

        const amountPaise = parsePriceInPaise(getCourseAmountValue(course));
        const detailLines = [
            `Course: ${getCourseTitle(course)}`,
            course.duration ? `Duration: ${course.duration}` : '',
            course.format ? `Format: ${course.format}` : '',
            `Fee: ${formatPaise(amountPaise)}`
        ].filter(Boolean);
        const orderText = [
            'New Course Enrollment',
            '',
            ...detailLines
        ].join('\n');

        return openPhonePeCheckout({
            amountPaise,
            description: getCourseTitle(course),
            orderText
        });
    }

    function checkoutProducts(cartItems, deliveryInfo, onConcluded) {
        let totalPaise = 0;
        const lines = ['New Product Order', ''];

        Object.values(cartItems || {}).forEach((item) => {
            const quantity = Math.max(1, Number(item.quantity || 1));
            const itemPaise = parsePriceInPaise(item.price) * quantity;
            totalPaise += itemPaise;
            lines.push(`- ${item.name} x${quantity} = ${formatPaise(itemPaise)}`);
        });

        lines.push('');
        lines.push(`Total: ${formatPaise(totalPaise)}`);
        lines.push('');
        lines.push('Delivery Details');
        lines.push(`Name: ${deliveryInfo.name}`);
        lines.push(`Email: ${deliveryInfo.email}`);
        lines.push(`Phone: ${deliveryInfo.phone}`);
        lines.push(`Address: ${deliveryInfo.address}, ${deliveryInfo.city}, ${deliveryInfo.state} - ${deliveryInfo.zipcode}, ${deliveryInfo.country}`);
        if (deliveryInfo.notes) lines.push(`Notes: ${deliveryInfo.notes}`);

        return openPhonePeCheckout({
            amountPaise: totalPaise,
            description: `Mystical Products - ${Object.keys(cartItems || {}).length} item(s)`,
            orderText: lines.join('\n'),
            prefill: {
                name: deliveryInfo.name,
                email: deliveryInfo.email,
                phone: deliveryInfo.phone
            },
            onConcluded
        });
    }

    function bookTarotReading(cardName, sessionInfo) {
        if (!sessionInfo || !sessionInfo.price) {
            return bookingRequest(`a tarot reading for ${cardName || 'a card'}`);
        }

        const amountPaise = parsePriceInPaise(sessionInfo.price);
        const orderText = [
            'New Tarot Reading Booking',
            '',
            `Card: ${cardName}`,
            `Session: ${sessionInfo.title || ''}`,
            `Fee: ${formatPaise(amountPaise)}`
        ].join('\n');

        return openPhonePeCheckout({
            amountPaise,
            description: `Tarot Reading - ${cardName}`,
            orderText
        });
    }

    function bookingRequest(bookMessage) {
        const label = bookMessage || 'a session';
        return openWhatsApp(`Hello, I would like to book ${label}. Please share the next available slot and UPI payment details.`);
    }

    const paymentApi = {
        openPhonePeCheckout,
        openUpiPayment,
        requestUpiPayment,
        requestPhonePePaymentLink,
        bookSession,
        orderPackage,
        joinCourse,
        checkoutProducts,
        bookTarotReading,
        bookingRequest,
        parsePriceInPaise,
        formatPaise
    };

    window.UpiPayment = paymentApi;
    window.PhonePePayment = paymentApi;
})();
