package se.joakimeriksson.iso20022;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

/**
 * Represents an account statement (camt.053) from ISO 20022 format.
 * Contains multiple payment transactions for a specific account.
 */
public class AccountStatement {
    private String messageId;
    private LocalDateTime creationDateTime;
    private String statementId;
    private LocalDateTime fromDateTime;
    private LocalDateTime toDateTime;
    private String accountIban;
    private String accountCurrency;
    private BigDecimal openingBalance;
    private BigDecimal closingBalance;
    private List<Payment> payments;

    public AccountStatement() {
        this.payments = new ArrayList<>();
    }

    public String getMessageId() {
        return messageId;
    }

    public void setMessageId(String messageId) {
        this.messageId = messageId;
    }

    public LocalDateTime getCreationDateTime() {
        return creationDateTime;
    }

    public void setCreationDateTime(LocalDateTime creationDateTime) {
        this.creationDateTime = creationDateTime;
    }

    public String getStatementId() {
        return statementId;
    }

    public void setStatementId(String statementId) {
        this.statementId = statementId;
    }

    public LocalDateTime getFromDateTime() {
        return fromDateTime;
    }

    public void setFromDateTime(LocalDateTime fromDateTime) {
        this.fromDateTime = fromDateTime;
    }

    public LocalDateTime getToDateTime() {
        return toDateTime;
    }

    public void setToDateTime(LocalDateTime toDateTime) {
        this.toDateTime = toDateTime;
    }

    public String getAccountIban() {
        return accountIban;
    }

    public void setAccountIban(String accountIban) {
        this.accountIban = accountIban;
    }

    public String getAccountCurrency() {
        return accountCurrency;
    }

    public void setAccountCurrency(String accountCurrency) {
        this.accountCurrency = accountCurrency;
    }

    public BigDecimal getOpeningBalance() {
        return openingBalance;
    }

    public void setOpeningBalance(BigDecimal openingBalance) {
        this.openingBalance = openingBalance;
    }

    public BigDecimal getClosingBalance() {
        return closingBalance;
    }

    public void setClosingBalance(BigDecimal closingBalance) {
        this.closingBalance = closingBalance;
    }

    public List<Payment> getPayments() {
        return payments;
    }

    public void addPayment(Payment payment) {
        this.payments.add(payment);
    }

    @Override
    public String toString() {
        return "AccountStatement{" +
                "messageId='" + messageId + '\'' +
                ", statementId='" + statementId + '\'' +
                ", accountIban='" + accountIban + '\'' +
                ", fromDateTime=" + fromDateTime +
                ", toDateTime=" + toDateTime +
                ", openingBalance=" + openingBalance +
                ", closingBalance=" + closingBalance +
                ", payments=" + payments.size() +
                '}';
    }
}
