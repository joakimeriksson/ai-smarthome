package se.joakimeriksson.iso20022;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;

/**
 * Represents a single payment transaction from ISO 20022 format.
 * This replaces the information previously found in BGMAX files.
 */
public class Payment {
    private String transactionId;
    private String accountServicerReference;
    private BigDecimal amount;
    private String currency;
    private LocalDate bookingDate;
    private LocalDateTime valueDate;
    private String debtorName;
    private String debtorAccount;
    private String debtorBankBic;
    private String creditorName;
    private String creditorAccount;
    private String creditorBankBic;
    private String remittanceInformation;
    private String ocrReference;
    private String endToEndId;
    private String mandateId;
    private boolean creditDebitIndicator; // true = credit, false = debit
    private String bankTransactionCode;

    // Getters and Setters
    public String getTransactionId() {
        return transactionId;
    }

    public void setTransactionId(String transactionId) {
        this.transactionId = transactionId;
    }

    public String getAccountServicerReference() {
        return accountServicerReference;
    }

    public void setAccountServicerReference(String accountServicerReference) {
        this.accountServicerReference = accountServicerReference;
    }

    public BigDecimal getAmount() {
        return amount;
    }

    public void setAmount(BigDecimal amount) {
        this.amount = amount;
    }

    public String getCurrency() {
        return currency;
    }

    public void setCurrency(String currency) {
        this.currency = currency;
    }

    public LocalDate getBookingDate() {
        return bookingDate;
    }

    public void setBookingDate(LocalDate bookingDate) {
        this.bookingDate = bookingDate;
    }

    public LocalDateTime getValueDate() {
        return valueDate;
    }

    public void setValueDate(LocalDateTime valueDate) {
        this.valueDate = valueDate;
    }

    public String getDebtorName() {
        return debtorName;
    }

    public void setDebtorName(String debtorName) {
        this.debtorName = debtorName;
    }

    public String getDebtorAccount() {
        return debtorAccount;
    }

    public void setDebtorAccount(String debtorAccount) {
        this.debtorAccount = debtorAccount;
    }

    public String getDebtorBankBic() {
        return debtorBankBic;
    }

    public void setDebtorBankBic(String debtorBankBic) {
        this.debtorBankBic = debtorBankBic;
    }

    public String getCreditorName() {
        return creditorName;
    }

    public void setCreditorName(String creditorName) {
        this.creditorName = creditorName;
    }

    public String getCreditorAccount() {
        return creditorAccount;
    }

    public void setCreditorAccount(String creditorAccount) {
        this.creditorAccount = creditorAccount;
    }

    public String getCreditorBankBic() {
        return creditorBankBic;
    }

    public void setCreditorBankBic(String creditorBankBic) {
        this.creditorBankBic = creditorBankBic;
    }

    public String getRemittanceInformation() {
        return remittanceInformation;
    }

    public void setRemittanceInformation(String remittanceInformation) {
        this.remittanceInformation = remittanceInformation;
    }

    public String getOcrReference() {
        return ocrReference;
    }

    public void setOcrReference(String ocrReference) {
        this.ocrReference = ocrReference;
    }

    public String getEndToEndId() {
        return endToEndId;
    }

    public void setEndToEndId(String endToEndId) {
        this.endToEndId = endToEndId;
    }

    public String getMandateId() {
        return mandateId;
    }

    public void setMandateId(String mandateId) {
        this.mandateId = mandateId;
    }

    public boolean isCreditDebitIndicator() {
        return creditDebitIndicator;
    }

    public void setCreditDebitIndicator(boolean creditDebitIndicator) {
        this.creditDebitIndicator = creditDebitIndicator;
    }

    public String getBankTransactionCode() {
        return bankTransactionCode;
    }

    public void setBankTransactionCode(String bankTransactionCode) {
        this.bankTransactionCode = bankTransactionCode;
    }

    @Override
    public String toString() {
        return "Payment{" +
                "transactionId='" + transactionId + '\'' +
                ", amount=" + amount +
                ", currency='" + currency + '\'' +
                ", bookingDate=" + bookingDate +
                ", " + (creditDebitIndicator ? "CREDIT" : "DEBIT") +
                ", debtorName='" + debtorName + '\'' +
                ", creditorName='" + creditorName + '\'' +
                ", ocrReference='" + ocrReference + '\'' +
                ", remittanceInformation='" + remittanceInformation + '\'' +
                '}';
    }
}
