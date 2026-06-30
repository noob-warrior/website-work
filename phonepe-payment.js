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
    let activeConfirmationPayment = null;
    let pendingCustomerPayment = null;
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

    function cleanText(value) {
        return String(value || '').replace(/\s+/g, ' ').trim();
    }

    function cleanMultilineText(value) {
        return String(value || '')
            .split('\n')
            .map((line) => line.trim())
            .join('\n')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
    }

    function normalizeCustomerDetails(details) {
        details = details || {};
        return {
            name: cleanText(details.name),
            email: cleanText(details.email),
            phone: cleanText(details.phone),
            notes: cleanText(details.notes)
        };
    }

    function buildCustomerDetailLines(details) {
        const customer = normalizeCustomerDetails(details);
        const lines = [];

        if (customer.name || customer.email || customer.phone || customer.notes) {
            lines.push('', 'Customer Details');
            if (customer.name) lines.push(`Name: ${customer.name}`);
            if (customer.email) lines.push(`Email: ${customer.email}`);
            if (customer.phone) lines.push(`WhatsApp/Phone: ${customer.phone}`);
            if (customer.notes) lines.push(`Notes: ${customer.notes}`);
        }

        return lines;
    }

    function addCustomerDetailsToOptions(options, details) {
        const customer = normalizeCustomerDetails(details);
        const baseOrderText = cleanMultilineText(options.orderText || options.description || 'Payment Request');
        const customerLines = buildCustomerDetailLines(customer);

        return {
            ...options,
            customerRequired: false,
            customerDetails: customer,
            prefill: {
                ...(options.prefill || {}),
                name: customer.name,
                email: customer.email,
                phone: customer.phone
            },
            orderText: [baseOrderText, ...customerLines].filter(Boolean).join('\n')
        };
    }

    function buildPaymentConfirmationMessage(options) {
        options = options || {};
        const lines = ['I have completed payment.', ''];
        const orderText = cleanMultilineText(options.orderText);

        if (orderText) {
            lines.push(orderText, '');
        } else {
            lines.push(`Payment For: ${options.description || BUSINESS_NAME}`);
        }

        lines.push(`Paid Amount: ${formatPaise(options.amountPaise)}`);
        lines.push(`UPI ID: ${getUpiId()}`);
        lines.push(`Payment Note: ${getUpiTransactionNote(options)}`);
        lines.push('');
        lines.push('Transaction ID / Screenshot: I will share it here.');

        return lines.join('\n');
    }

    function sendPaymentConfirmation(options) {
        const message = buildPaymentConfirmationMessage(options);
        setStatus('Opening WhatsApp confirmation with your payment details...', 'success');
        return openWhatsApp(message);
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

    function closePaymentConfirmationModal() {
        const modal = document.querySelector('[data-upi-confirmation-modal]');
        if (!modal) return;

        modal.hidden = true;
        modal.classList.remove('is-open');
        document.body.classList.remove('upi-qr-modal-open');
        activeConfirmationPayment = null;
    }

    function closeCustomerDetailsModal() {
        const modal = document.querySelector('[data-upi-customer-modal]');
        if (!modal) return;

        modal.hidden = true;
        modal.classList.remove('is-open');
        document.body.classList.remove('upi-qr-modal-open');
        pendingCustomerPayment = null;
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
                    <button class="upi-qr-done" type="button" data-upi-qr-paid>I've paid - Send WhatsApp confirmation</button>
                </div>
            </div>
        `;

        modal.addEventListener('click', (event) => {
            if (event.target === modal || event.target.closest('[data-upi-qr-close]')) {
                closePaymentQrModal();
                return;
            }

            if (event.target.closest('[data-upi-qr-paid]')) {
                const paymentToConfirm = activeQrPayment ? { ...activeQrPayment } : null;
                const onConcluded = activeQrPayment?.onConcluded;
                closePaymentQrModal();
                if (paymentToConfirm) {
                    sendPaymentConfirmation(paymentToConfirm);
                } else {
                    setStatus('Payment marked complete. Thank you.', 'success');
                }
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

    function ensurePaymentConfirmationModal() {
        let modal = document.querySelector('[data-upi-confirmation-modal]');
        if (modal) return modal;

        modal = document.createElement('div');
        modal.className = 'upi-qr-modal upi-confirmation-modal';
        modal.dataset.upiConfirmationModal = '';
        modal.hidden = true;
        modal.innerHTML = `
            <div class="upi-qr-dialog upi-confirmation-dialog" role="dialog" aria-modal="true" aria-labelledby="upiConfirmTitle">
                <button class="upi-qr-close" type="button" data-upi-confirmation-close aria-label="Close payment confirmation">
                    <span aria-hidden="true">x</span>
                </button>
                <div class="upi-qr-heading">
                    <div class="phonepe-logo-mark">UPI</div>
                    <div>
                        <h2 id="upiConfirmTitle">Send payment confirmation</h2>
                        <p>After your UPI app shows success, send the details on WhatsApp so your booking can be matched to you.</p>
                    </div>
                </div>
                <div class="upi-qr-details" aria-live="polite">
                    <div>
                        <span>Amount</span>
                        <strong data-upi-confirmation-amount></strong>
                    </div>
                    <div>
                        <span>UPI ID</span>
                        <strong data-upi-confirmation-upi></strong>
                    </div>
                    <div>
                        <span>Note</span>
                        <strong data-upi-confirmation-note></strong>
                    </div>
                </div>
                <p class="upi-confirmation-copy">Please attach your payment screenshot or type the UPI transaction ID in WhatsApp after it opens.</p>
                <div class="upi-qr-actions">
                    <a class="upi-qr-link" href="#" data-upi-confirmation-direct>Open UPI app again</a>
                    <button class="upi-qr-done" type="button" data-upi-confirmation-send>Send WhatsApp confirmation</button>
                </div>
            </div>
        `;

        modal.addEventListener('click', (event) => {
            if (event.target === modal || event.target.closest('[data-upi-confirmation-close]')) {
                closePaymentConfirmationModal();
                return;
            }

            if (event.target.closest('[data-upi-confirmation-send]')) {
                const paymentToConfirm = activeConfirmationPayment ? { ...activeConfirmationPayment } : null;
                const onConcluded = activeConfirmationPayment?.onConcluded;
                if (paymentToConfirm) {
                    sendPaymentConfirmation(paymentToConfirm);
                }
                closePaymentConfirmationModal();
                if (typeof onConcluded === 'function') {
                    onConcluded();
                }
            }
        });

        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && !modal.hidden) {
                closePaymentConfirmationModal();
            }
        });

        document.body.appendChild(modal);
        return modal;
    }

    function showPaymentConfirmationModal(options, upiUrl) {
        const modal = ensurePaymentConfirmationModal();
        activeConfirmationPayment = { ...options, upiUrl };

        modal.querySelector('[data-upi-confirmation-amount]').textContent = formatPaise(options.amountPaise);
        modal.querySelector('[data-upi-confirmation-upi]').textContent = getUpiId();
        modal.querySelector('[data-upi-confirmation-note]').textContent = getUpiTransactionNote(options);
        modal.querySelector('[data-upi-confirmation-direct]').href = upiUrl;

        modal.hidden = false;
        modal.classList.add('is-open');
        document.body.classList.add('upi-qr-modal-open');
    }

    function ensureCustomerDetailsModal() {
        let modal = document.querySelector('[data-upi-customer-modal]');
        if (modal) return modal;

        modal = document.createElement('div');
        modal.className = 'upi-qr-modal upi-customer-modal';
        modal.dataset.upiCustomerModal = '';
        modal.hidden = true;
        modal.innerHTML = `
            <div class="upi-qr-dialog upi-customer-dialog" role="dialog" aria-modal="true" aria-labelledby="upiCustomerTitle">
                <button class="upi-qr-close" type="button" data-upi-customer-close aria-label="Close payment details">
                    <span aria-hidden="true">x</span>
                </button>
                <div class="upi-qr-heading">
                    <div class="phonepe-logo-mark">UPI</div>
                    <div>
                        <h2 id="upiCustomerTitle">Contact details</h2>
                        <p>These details will be included in the WhatsApp confirmation after payment.</p>
                    </div>
                </div>
                <form class="upi-customer-form" data-upi-customer-form>
                    <div class="form-group">
                        <label for="upiCustomerName">Full Name *</label>
                        <input type="text" id="upiCustomerName" autocomplete="name" required>
                    </div>
                    <div class="form-group">
                        <label for="upiCustomerPhone">WhatsApp / Phone Number *</label>
                        <input type="tel" id="upiCustomerPhone" autocomplete="tel" required>
                    </div>
                    <div class="form-group">
                        <label for="upiCustomerEmail">Email Address</label>
                        <input type="email" id="upiCustomerEmail" autocomplete="email">
                    </div>
                    <div class="form-group">
                        <label for="upiCustomerNotes">Message / Notes</label>
                        <textarea id="upiCustomerNotes" rows="3" placeholder="Birth details, preferred time, or any question"></textarea>
                    </div>
                    <div class="upi-qr-actions upi-customer-actions">
                        <button class="upi-qr-link" type="button" data-upi-customer-cancel>Cancel</button>
                        <button class="upi-qr-done" type="submit">Continue to UPI</button>
                    </div>
                </form>
            </div>
        `;

        modal.addEventListener('click', (event) => {
            if (event.target === modal || event.target.closest('[data-upi-customer-close]') || event.target.closest('[data-upi-customer-cancel]')) {
                closeCustomerDetailsModal();
            }
        });

        modal.querySelector('[data-upi-customer-form]').addEventListener('submit', (event) => {
            event.preventDefault();

            if (!pendingCustomerPayment) return;

            const details = {
                name: modal.querySelector('#upiCustomerName').value,
                phone: modal.querySelector('#upiCustomerPhone').value,
                email: modal.querySelector('#upiCustomerEmail').value,
                notes: modal.querySelector('#upiCustomerNotes').value
            };
            const paymentOptions = addCustomerDetailsToOptions(pendingCustomerPayment, details);

            closeCustomerDetailsModal();
            openPhonePeCheckout(paymentOptions);
        });

        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && !modal.hidden) {
                closeCustomerDetailsModal();
            }
        });

        document.body.appendChild(modal);
        return modal;
    }

    function requestCustomerDetails(options) {
        const modal = ensureCustomerDetailsModal();
        const prefill = options.prefill || {};

        pendingCustomerPayment = { ...options, customerRequired: false };
        modal.querySelector('#upiCustomerName').value = prefill.name || '';
        modal.querySelector('#upiCustomerPhone').value = prefill.phone || '';
        modal.querySelector('#upiCustomerEmail').value = prefill.email || '';
        modal.querySelector('#upiCustomerNotes').value = '';

        modal.hidden = false;
        modal.classList.add('is-open');
        document.body.classList.add('upi-qr-modal-open');
        modal.querySelector('#upiCustomerName').focus();
        return true;
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
        showPaymentConfirmationModal(paymentOptions, upiUrl);
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

        if (options.customerRequired && !options.customerDetails) {
            return requestCustomerDetails({ ...options, amountPaise });
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
            orderText,
            customerRequired: true
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
            orderText,
            customerRequired: true
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
            orderText,
            customerRequired: true
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
            orderText,
            customerRequired: true
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
