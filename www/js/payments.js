const SUPABASE_URL = 'https://cffqfilqeivypbflfnwu.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNmZnFmaWxxZWl2eXBiZmxmbnd1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI0OTMxNjEsImV4cCI6MjA4ODA2OTE2MX0.x9EpedZv5B_xDHUWKTQE0keblbvh9fWcJkRKfS6ihZ4';

const plans = {
    weekly: { id: 'weekly', name: 'Icyumweru 1', price: 500 },
    monthly: { id: 'monthly', name: 'Ukwezi 1', price: 2500 },
    promo: { id: 'promo', name: 'Takalamo PROMO', price: 1500 }
};

let selectedPlan = null;

function openPaymentModal(planId) {
    selectedPlan = plans[planId];
    if (!selectedPlan) return;

    // Create modal if it doesn't exist
    let modal = document.getElementById('payment-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'payment-modal';
        modal.className = 'fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm hidden';
        modal.innerHTML = `
            <div class="bg-white rounded-[2.5rem] w-full max-w-md p-8 shadow-2xl relative animate-in fade-in zoom-in duration-300">
                <button onclick="closePaymentModal()" class="absolute top-6 right-6 text-gray-400 hover:text-gray-600">
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                </button>
                
                <div class="text-center mb-8">
                    <div class="h-16 w-16 bg-primary/10 rounded-2xl flex items-center justify-center text-primary mx-auto mb-4">
                        <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2" ry="2"></rect><line x1="2" y1="10" x2="22" y2="10"></line></svg>
                    </div>
                    <h3 class="text-xl font-black uppercase italic" id="modal-plan-name">Kwishyura</h3>
                    <p class="text-gray-400 font-bold mt-1" id="modal-plan-price">0 FRW</p>
                </div>

                <div class="space-y-6">
                    <div>
                        <label class="block text-[10px] font-black uppercase text-gray-400 mb-2 ml-2 italic tracking-widest">Numero ya MoMo</label>
                        <input type="tel" id="payment-phone" placeholder="078... cyangwa 079..." 
                            class="w-full bg-gray-50 border-2 border-gray-100 rounded-2xl px-6 py-4 font-bold text-lg focus:border-primary focus:bg-white transition-all outline-none">
                    </div>

                    <button onclick="processPayment()" id="pay-btn"
                        class="w-full bg-primary text-white py-5 rounded-2xl font-black uppercase italic shadow-lg shadow-primary/30 hover:bg-blue-700 transition-all tracking-widest flex items-center justify-center gap-3">
                        <span>Ishyura ubu</span>
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
                    </button>
                    
                    <p class="text-[10px] text-center text-gray-400 font-bold italic">Kanda hano ushyireho numero yawe ya MTN cyangwa Airtel-Tigo</p>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    }

    document.getElementById('modal-plan-name').textContent = selectedPlan.name;
    document.getElementById('modal-plan-price').textContent = `${selectedPlan.price} FRW`;

    // Fill phone if exists in stats
    const stats = JSON.parse(localStorage.getItem('userStats') || '{}');
    if (stats.phone) {
        document.getElementById('payment-phone').value = stats.phone;
    }

    modal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
}

function closePaymentModal() {
    const modal = document.getElementById('payment-modal');
    if (modal) modal.classList.add('hidden');
    document.body.style.overflow = '';
}

async function processPayment() {
    const phone = document.getElementById('payment-phone').value.trim();
    const payBtn = document.getElementById('pay-btn');

    if (!phone || phone.length < 10) {
        alert('Nyamuneka shyiramo numero ya MoMo yuzuye.');
        return;
    }

    const stats = JSON.parse(localStorage.getItem('userStats') || '{}');
    const userId = stats.id || `user_${Date.now()}`;
    const email = stats.email || `${userId}@itarago.rw`;

    payBtn.disabled = true;
    payBtn.innerHTML = `
        <svg class="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
        <span>Utegerezwa...</span>
    `;

    try {
        const response = await fetch(`${SUPABASE_URL}/functions/v1/initiate-payment`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
            },
            body: JSON.stringify({
                phone_number: phone,
                amount: selectedPlan.price,
                email: email,
                userId: userId,
                planId: selectedPlan.id
            })
        });

        const result = await response.json();

        if (result.success) {
            // Redirect to Flutterwave checkout URL if provided, or handle status
            if (result.data && result.data.link) {
                window.location.href = result.data.link;
            } else if (result.meta && result.meta.authorization && result.meta.authorization.redirect) {
                window.location.href = result.meta.authorization.redirect;
            } else {
                // If it's a direct charge (like MoMo), it might just be pending
                alert('Teguza kuri terefone yawe, wemeze kwishyura (MoMo Push).');
                // Could start polling status here
            }
        } else {
            alert(`Ikibazo: ${result.error || 'Ntabwo bidashobotse gutangira kwishyura.'}`);
            payBtn.disabled = false;
            payBtn.innerHTML = `<span>Ishyura ubu</span> <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>`;
        }
    } catch (error) {
        console.error('Payment Error:', error);
        alert('Habaye ikibazo mu itumanaho. Nyamuneka ongera ugerageze.');
        payBtn.disabled = false;
        payBtn.innerHTML = `<span>Ishyura ubu</span> <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>`;
    }
}

// Check for payment status on load if redirecting back
document.addEventListener('DOMContentLoaded', () => {
    const urlParams = new URLSearchParams(window.location.search);
    const paymentStatus = urlParams.get('payment');
    const txn = urlParams.get('txn');

    if (paymentStatus === 'success') {
        const stats = JSON.parse(localStorage.getItem('userStats') || '{}');
        stats.plan = 'active'; // Or specific planId if known
        stats.status = 'active';
        localStorage.setItem('userStats', JSON.stringify(stats));

        // Show success alert/modal
        showStatusModal('Ishyura ryagenze neza!', 'Mukoze kwishyura. Ubu mufite uburenganzira bwose.', 'success');
    } else if (paymentStatus === 'failed') {
        showStatusModal('Ishyura ntabwo ryakunze', 'Nyamuneka ongera ugerageze cyangwa uduhamagare tugufashe.', 'error');
    }
});

function showStatusModal(title, message, type) {
    const color = type === 'success' ? 'text-green-500' : 'text-red-500';
    const bg = type === 'success' ? 'bg-green-50' : 'bg-red-50';
    const icon = type === 'success' ? '✅' : '❌';

    const statusModal = document.createElement('div');
    statusModal.className = 'fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm';
    statusModal.innerHTML = `
        <div class="bg-white rounded-[2.5rem] w-full max-w-sm p-8 shadow-2xl text-center relative animate-in fade-in zoom-in duration-300">
            <div class="h-20 w-20 ${bg} rounded-full flex items-center justify-center text-4xl mx-auto mb-6">
                ${icon}
            </div>
            <h3 class="text-xl font-black uppercase italic ${color} mb-2">${title}</h3>
            <p class="text-gray-500 font-bold mb-8 leading-relaxed">${message}</p>
            <button onclick="this.closest('.fixed').remove()" class="w-full bg-gray-900 text-white py-4 rounded-xl font-black uppercase italic tracking-widest hover:bg-gray-800 transition-all">Simbuka</button>
        </div>
    `;
    document.body.appendChild(statusModal);
}
