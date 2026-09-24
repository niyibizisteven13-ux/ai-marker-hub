import { v4 as uuidv4 } from 'uuid';
import logger from '../utils/logger.js';

export interface MomoPaymentRequest {
  amount: number;
  phoneNumber: string;
  batchId: string;
  userId: string;
  service?: string;
  externalRef?: string;
}

export class PaymentService {
  private static instance: PaymentService;

  private MOMO_API_URL = process.env.MOMO_API_URL || 'https://sandbox.momodeveloper.mtn.com';
  private MOMO_SUBSCRIPTION_KEY = process.env.MOMO_SUBSCRIPTION_KEY;
  private MOMO_API_USER = process.env.MOMO_API_USER;
  private MOMO_API_KEY = process.env.MOMO_API_KEY;
  private MOMO_TARGET_ENV = process.env.MOMO_TARGET_ENV || 'sandbox';

  private accessToken: string | null = null;
  private tokenExpiry: number = 0;

  private constructor() {}

  public static getInstance(): PaymentService {
    if (!PaymentService.instance) {
      PaymentService.instance = new PaymentService();
    }
    return PaymentService.instance;
  }

  /**
   * MTN MoMo OAuth2: Get or refresh access token
   */
  private async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiry) {
      return this.accessToken;
    }

    if (!this.MOMO_API_USER || !this.MOMO_API_KEY || !this.MOMO_SUBSCRIPTION_KEY) {
      throw new Error('MoMo credentials missing');
    }

    const auth = Buffer.from(`${this.MOMO_API_USER}:${this.MOMO_API_KEY}`).toString('base64');

    const response = await fetch(`${this.MOMO_API_URL}/collection/token/`, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': this.MOMO_SUBSCRIPTION_KEY,
        'Authorization': `Basic ${auth}`
      }
    });

    if (!response.ok) {
      const err = await response.text();
      logger.error('MoMo Token Error', { status: response.status, body: err });
      throw new Error('Failed to get MoMo access token');
    }

    const data: any = await response.json();
    this.accessToken = data.access_token;
    this.tokenExpiry = Date.now() + (data.expires_in - 60) * 1000;

    return this.accessToken!;
  }

  /**
   * Initiates an MTN MoMo "Request to Pay" (MoCP) transaction.
   */
  public async initiateMomoPayment(request: MomoPaymentRequest) {
    const externalId = request.externalRef || uuidv4();
    const USD_TO_RWF = 1470;
    const amountInRwf = Math.round(request.amount * USD_TO_RWF);

    if (process.env.NODE_ENV !== 'production' && !this.MOMO_API_KEY) {
      logger.info('SIMULATED MoMo Request to Pay (Dev/Sandbox)', {
        batchId: request.batchId,
        amountUsd: request.amount,
        amountRwf: amountInRwf,
        phone: request.phoneNumber,
        externalId
      });

      return {
        success: true,
        externalId,
        status: 'PENDING',
        message: `Sandbox: Payment request for ${amountInRwf} RWF sent to phone`
      };
    }

    try {
      const token = await this.getAccessToken();

      const payload = {
        amount: amountInRwf.toString(),
        currency: 'RWF',
        externalId: request.batchId,
        payer: {
          partyIdType: 'MSISDN',
          partyId: request.phoneNumber
        },
        payerMessage: 'Unlock Marker AI results',
        payeeNote: 'Marker AI Assessment'
      };

      const response = await fetch(`${this.MOMO_API_URL}/collection/v1_0/requesttopay`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'X-Reference-Id': externalId,
          'X-Target-Environment': this.MOMO_TARGET_ENV,
          'Ocp-Apim-Subscription-Key': this.MOMO_SUBSCRIPTION_KEY!,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      if (response.status !== 202) {
        const err = await response.text();
        logger.error('MoMo RequestToPay Error', { status: response.status, body: err });
        throw new Error('Payment initiation failed at provider');
      }

      return {
        success: true,
        externalId,
        status: 'PENDING'
      };
    } catch (err: any) {
      logger.error('MoMo Initiation Failed', err);
      throw err;
    }
  }

  /**
   * Polls MoMo API for the current status of a transaction
   */
  public async verifyPaymentStatus(externalId: string) {
    if (process.env.NODE_ENV !== 'production' && !this.MOMO_API_KEY) {
       return { status: 'SUCCESSFUL', externalId };
    }

    try {
      const token = await this.getAccessToken();
      const response = await fetch(`${this.MOMO_API_URL}/collection/v1_0/requesttopay/${externalId}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'X-Target-Environment': this.MOMO_TARGET_ENV,
          'Ocp-Apim-Subscription-Key': this.MOMO_SUBSCRIPTION_KEY!
        }
      });

      if (!response.ok) return { status: 'PENDING', externalId };

      const data: any = await response.json();
      return { status: data.status, externalId }; // SUCCESSFUL, FAILED, PENDING
    } catch (err) {
      logger.error('MoMo Status Poll Failed', { externalId, err });
      return { status: 'PENDING', externalId };
    }
  }

  public async getPriceForJob(jobId: string, service: string): Promise<number> {
    // Basic tiering: $0.20 for small batches
    return 0.20;
  }

  public async convertUsdToRwf(usdAmount: number): Promise<number> {
    const USD_TO_RWF = 1470;
    return Math.round(usdAmount * USD_TO_RWF);
  }

  /**
   * Creates a Stripe Checkout Session for subscription upgrades.
   */
  public async createStripeCheckoutSession(userId: string, plan: string) {
    logger.info('Creating Stripe Checkout Session', { userId, plan });
    const sessionId = `stripe-session-${uuidv4()}`;
    return {
      success: true,
      sessionId,
      url: `https://checkout.stripe.com/pay/${sessionId}?mock=true`
    };
  }
}
